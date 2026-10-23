package app

// Settings the studio edits (mirrored by src/node/settings.ts for the CLI):
//
//	<config dir>/kino/config.json  global: provider credentials and commands, the
//	                               default provider, the narration cache, export quality
//	<project>/kino.json            per project: its narration provider and default voice
//
// Provider keys can also come from env vars, which win over the file.

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
)

// ProviderSettings configures one narration provider.
type ProviderSettings struct {
	APIKey  string `json:"apiKey,omitempty"`
	URL     string `json:"url,omitempty"`
	Command string `json:"command,omitempty"` // espeak / festival: the program to run
}

// TTSSettings holds every provider's settings and the default provider.
type TTSSettings struct {
	Provider   string           `json:"provider,omitempty"` // for projects that don't choose one
	Local      ProviderSettings `json:"local"`
	ElevenLabs ProviderSettings `json:"elevenlabs"`
	OpenAI     ProviderSettings `json:"openai"`
	Espeak     ProviderSettings `json:"espeak"`
	Festival   ProviderSettings `json:"festival"`
}

// ExportSettings tune the studio's MP4 and PDF exports.
type ExportSettings struct {
	VideoBitrate float64 `json:"videoBitrate,omitempty"` // Mbit/s (default 8)
	PDFScale     float64 `json:"pdfScale,omitempty"`     // page size × the video size (default 2)
}

// Settings are the global, per-user settings.
type Settings struct {
	TTS      TTSSettings    `json:"tts"`
	CacheDir string         `json:"cacheDir,omitempty"` // narration cache shared by every project ("" = each project's .kino-cache)
	Export   ExportSettings `json:"export"`
}

// SettingsView is what the settings dialog shows.
type SettingsView struct {
	Settings Settings `json:"settings"`
	File     string   `json:"file"`
	// Env lists the settings an environment variable currently overrides ("elevenlabs.apiKey" → "ELEVENLABS_API_KEY").
	Env map[string]string `json:"env"`
}

// ProjectSettings live in the project's kino.json.
type ProjectSettings struct {
	TTS ProjectTTS `json:"tts"`
}

// ProjectTTS is the narration a project uses. Voice holds default voice
// settings (speaker, model, language, speed...); the script's own apply over them.
type ProjectTTS struct {
	Provider string            `json:"provider,omitempty"` // "" = the global default
	Voice    map[string]string `json:"voice,omitempty"`
}

var providers = []string{"local", "elevenlabs", "openai", "espeak", "festival"}

// providerEnv maps "<provider>.<field>" to the env var that overrides it.
var providerEnv = map[string]string{
	"local.url":         "KINO_TTS_URL",
	"elevenlabs.apiKey": "ELEVENLABS_API_KEY",
	"elevenlabs.url":    "ELEVENLABS_BASE_URL",
	"openai.apiKey":     "OPENAI_API_KEY",
	"openai.url":        "OPENAI_BASE_URL",
}

// configFile can be moved for tests.
var configFile = func() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "kino", "config.json")
}

// loadSettings reads the global settings; it is read on every use, so edits
// (from the dialog or by hand) apply right away.
func loadSettings() Settings {
	var s Settings
	if f := configFile(); f != "" {
		if b, err := os.ReadFile(f); err == nil {
			_ = json.Unmarshal(b, &s)
		}
	}
	return s
}

func (t *TTSSettings) provider(name string) *ProviderSettings {
	switch name {
	case "local":
		return &t.Local
	case "elevenlabs":
		return &t.ElevenLabs
	case "openai":
		return &t.OpenAI
	case "espeak":
		return &t.Espeak
	case "festival":
		return &t.Festival
	}
	return &ProviderSettings{}
}

// providerSettings returns a provider's settings, env vars first.
func providerSettings(name string) ProviderSettings {
	s := loadSettings()
	c := *s.TTS.provider(name)
	if v := os.Getenv(providerEnv[name+".apiKey"]); v != "" {
		c.APIKey = v
	}
	if v := os.Getenv(providerEnv[name+".url"]); v != "" {
		c.URL = v
	}
	c.Command = expandHome(c.Command)
	return c
}

// Settings returns the global settings for the settings dialog.
func (a *App) Settings() SettingsView {
	env := map[string]string{}
	for k, v := range providerEnv {
		if os.Getenv(v) != "" {
			env[k] = v
		}
	}
	if os.Getenv("KINO_CACHE") != "" {
		env["cacheDir"] = "KINO_CACHE"
	}
	return SettingsView{Settings: loadSettings(), File: configFile(), Env: env}
}

// SaveSettings writes the global settings.
func (a *App) SaveSettings(s Settings) error {
	f := configFile()
	if f == "" {
		return errors.New("no user config folder on this system")
	}
	if s.TTS.Provider != "" && !validProvider(s.TTS.Provider) {
		return errors.New("unknown provider " + s.TTS.Provider)
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(f), 0o700); err != nil {
		return err
	}
	// it holds API keys: readable by the user only
	if err := writeAtomic(f, append(b, '\n')); err != nil {
		return err
	}
	elevenVoices.Clear() // the key may have changed
	return os.Chmod(f, 0o600)
}

func validProvider(p string) bool {
	for _, x := range providers {
		if x == p {
			return true
		}
	}
	return false
}

func projectSettingsFile(dir string) string { return filepath.Join(dir, "kino.json") }

func readProjectSettings(dir string) ProjectSettings {
	var ps ProjectSettings
	if b, err := os.ReadFile(projectSettingsFile(dir)); err == nil {
		_ = json.Unmarshal(b, &ps)
	}
	return ps
}

// SaveProjectSettings writes the open project's kino.json (keeping keys it doesn't know).
func (a *App) SaveProjectSettings(ps ProjectSettings) (*Project, error) {
	p, err := a.current()
	if err != nil {
		return nil, err
	}
	ps.TTS.Provider = strings.ToLower(ps.TTS.Provider)
	if ps.TTS.Provider != "" && !validProvider(ps.TTS.Provider) {
		return nil, errors.New("unknown provider " + ps.TTS.Provider)
	}
	for k, v := range ps.TTS.Voice {
		if strings.TrimSpace(v) == "" {
			delete(ps.TTS.Voice, k)
		}
	}
	file := projectSettingsFile(p.Dir)
	doc := map[string]any{}
	if b, err := os.ReadFile(file); err == nil {
		if err := json.Unmarshal(b, &doc); err != nil {
			return nil, errors.New("kino.json is not valid JSON; fix or delete it first")
		}
	}
	doc["tts"] = ps.TTS
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeAtomic(file, append(b, '\n')); err != nil {
		return nil, err
	}
	// set after writing: a watcher event for an older edit re-reads the file, which is now this
	a.mu.Lock()
	if a.project != nil && a.project.Path == p.Path {
		a.project.Settings = ps
	}
	a.mu.Unlock()
	return a.CurrentProject(), nil
}

// reloadProjectSettings picks up kino.json edits made outside the studio.
func (a *App) reloadProjectSettings(dir string) {
	ps := readProjectSettings(dir)
	a.mu.Lock()
	if a.project == nil || a.project.Dir != dir || reflect.DeepEqual(a.project.Settings, ps) {
		a.mu.Unlock()
		return
	}
	a.project.Settings = ps
	p := *a.project
	a.mu.Unlock()
	if b, err := os.ReadFile(p.Path); err == nil {
		p.Source = string(b)
	}
	a.send(EventProject, &p)
}
