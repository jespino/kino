// Package app holds the backend service of Kino Studio. The same struct is
// bound by Wails (desktop) and by the HTTP adapter (kino serve), so the UI
// talks to one API regardless of the shell.
//
// A project is a folder: one .kino script (the whole animation) plus the
// assets it references (images, voice recordings). The studio edits the
// script, an agent in the terminal panel edits it too, and every change on
// disk is pushed to the UI. The project, the recent list, the folder
// browser and the agent terminal come from agentstudio's studio.Workspace.
package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sync"

	"github.com/jespino/agentstudio/studio"
	"github.com/jespino/kino/internal/agentctx"
)

// Events emitted to the frontend.
const (
	EventProject = studio.EventProject // payload: *Project (nil when closed)
	EventSource  = studio.EventSource  // payload: SourceChange (the script changed on disk)
)

type (
	// Emitter delivers events to the frontend.
	Emitter = studio.Emitter
	// Dialogs are native file dialogs, provided by the desktop shell. In a
	// browser (kino serve) there are none and the UI uses its own folder browser.
	Dialogs = studio.Dialogs
	// Project is the open project; its Settings are a ProjectSettings (kino.json).
	Project = studio.Project
	// SourceChange is the script's new content after an edit on disk.
	SourceChange = studio.SourceChange
)

// Windows opens extra native windows (the desktop shell); nil in a browser,
// where the UI opens them itself.
type Windows interface {
	// OpenWindow opens (or brings to front) the window called name, showing url of the UI.
	OpenWindow(name, title, url string, width, height int)
}

// App is the service bound to the frontend. Exported methods are the API.
type App struct {
	*studio.Workspace

	mu       sync.Mutex
	tts      string // TTS server URL for tests ("" = env, settings, default)
	inflight map[string]*call
	status   *statusFile // what .kino/status.json holds
	windows  Windows
}

// SetWindows lets the app open native windows (the speaker view).
func (a *App) SetWindows(w Windows) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.windows = w
}

// HiddenMethods are the exported methods that are not part of the API.
func (a *App) HiddenMethods() []string {
	return append(a.Workspace.HiddenMethods(), "SetWindows")
}

// OpenSpeakerWindow opens the speaker view (notes, next slide, timer) in its
// own window. It returns false when the shell can't, and the UI should open
// a browser window instead.
func (a *App) OpenSpeakerWindow() bool {
	a.mu.Lock()
	w := a.windows
	a.mu.Unlock()
	if w == nil {
		return false
	}
	w.OpenWindow("speaker", "Kino Studio · Speaker view", "/#speaker", 1100, 720)
	return true
}

// New creates the service. docs are copied into projects for agents.
func New(emit Emitter, docs agentctx.Docs) *App {
	a := &App{inflight: map[string]*call{}}
	a.Workspace = studio.NewWorkspace(studio.Config{
		ID:         "kino",
		Ext:        ".kino",
		Default:    "project.kino",
		RecentFile: recentFile(),
		Agent: studio.Agent{
			Context: func(dir, file string) error { return agentctx.Write(dir, file, docs) },
			Env: func(dir, file string) []string {
				return []string{"KINO_PROJECT=" + dir, "KINO_FILE=" + file}
			},
		},
	}, studio.WorkspaceOptions{
		Template: projectTemplate,
		Prepare:  func(dir string) error { return os.MkdirAll(filepath.Join(dir, "assets"), 0o755) },
		Settings: func(dir string) any { return readProjectSettings(dir) },
		OnChange: a.fileChanged,
	})
	a.SetEmitter(emit)
	return a
}

// fileChanged picks up kino.json edits made outside the studio.
func (a *App) fileChanged(path string) {
	p, err := a.Current()
	if err != nil || path != projectSettingsFile(p.Dir) || reflect.DeepEqual(p.Settings, readProjectSettings(p.Dir)) {
		return
	}
	a.Refresh()
}

func (a *App) current() (*Project, error) { return a.Current() }

// recentFile can be moved for tests ("" keeps the default,
// <config>/kino/recent.json).
var recentFile = func() string { return "" }

// projectSettings returns the kino.json of a project.
func projectSettings(p *Project) ProjectSettings {
	ps, _ := p.Settings.(ProjectSettings)
	return ps
}

// NewProject creates dir (if needed) with <name>.kino holding source and an
// assets/ folder, and opens it. It fails if the script already exists.
// template names a custom template (see Templates) to start from instead of
// source; a folder template also brings its assets.
func (a *App) NewProject(dir, name, source, template string) (*Project, error) {
	if template == "" {
		return a.Workspace.NewProject(dir, name, source)
	}
	tmpl, err := customTemplate(template)
	if err != nil {
		return nil, err
	}
	return a.Create(dir, name, tmpl.Source, func(dir string) error {
		if err := copyTemplateAssets(tmpl, dir); err != nil {
			return fmt.Errorf("copying the template: %w", err)
		}
		return nil
	})
}

func writeAtomic(path string, b []byte) error { return studio.WriteAtomic(path, b) }

// Status is what the studio reports after compiling the script; it is
// written to .kino/status.json for agents.
type Status struct {
	OK        bool            `json:"ok"`
	Error     json.RawMessage `json:"error,omitempty"`
	Duration  float64         `json:"duration"`
	Steps     json.RawMessage `json:"steps,omitempty"`
	Narration json.RawMessage `json:"narration,omitempty"`
}

// statusFile is the content of .kino/status.json.
type statusFile struct {
	File   string `json:"file"`
	SHA256 string `json:"sha256"`
	Status
	// Sheet is set once .kino/sheet.png shows this same compile.
	Sheet string `json:"sheet,omitempty"`
}

// ReportStatus writes .kino/status.json for the compiled source.
func (a *App) ReportStatus(source string, st Status) error {
	p, err := a.current()
	if err != nil {
		return err
	}
	sum := sha256.Sum256([]byte(source))
	out := &statusFile{File: filepath.Base(p.Path), SHA256: hex.EncodeToString(sum[:]), Status: st}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.status = out
	return writeStatus(p.Dir, out)
}

// ReportSheet writes .kino/sheet.png, the contact sheet of the compiled
// source (every page, labeled with its line), and marks status.json as
// matching it. A sheet for a source that's no longer the last reported one
// is dropped.
func (a *App) ReportSheet(source string, png []byte) error {
	p, err := a.current()
	if err != nil {
		return err
	}
	sum := sha256.Sum256([]byte(source))
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.status == nil || a.status.SHA256 != hex.EncodeToString(sum[:]) {
		return nil
	}
	dir := filepath.Join(p.Dir, ".kino")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := writeAtomic(filepath.Join(dir, "sheet.png"), png); err != nil {
		return err
	}
	a.status.Sheet = ".kino/sheet.png"
	return writeStatus(p.Dir, a.status)
}

func writeStatus(project string, st *statusFile) error {
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Join(project, ".kino")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return writeAtomic(filepath.Join(dir, "status.json"), append(b, '\n'))
}

// watch reports edits of file made by others (an agent, another editor).

func projectTemplate(name string) string {
	return fmt.Sprintf(`// %s: a Kino animation. The language reference is docs/DSL.md in the Kino repo.
video { size: (1280, 720), theme: neon }

frame "title" {
  t: title at center() { text: %q, subtitle: "Edit me, or ask the agent" }
}
`, name, name)
}
