package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// fakeHosted serves the ElevenLabs and OpenAI endpoints kino uses, answering with 0.5s of PCM.
func fakeHosted(t *testing.T, got map[string]any) *httptest.Server {
	pcm := make([]byte, pcmRate) // 0.5s of 16-bit mono
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/voices":
			if r.Header.Get("xi-api-key") != "eleven-key" {
				w.WriteHeader(401)
				return
			}
			w.Write([]byte(`{"voices":[{"voice_id":"aaaaaaaaaaaaaaaaaaaa","name":"Sarah - Mature, Reassuring"}]}`))
		case strings.HasPrefix(r.URL.Path, "/v1/text-to-speech/"):
			got["path"] = r.URL.String()
			json.NewDecoder(r.Body).Decode(&got)
			w.Write(pcm)
		case r.URL.Path == "/audio/speech":
			got["auth"] = r.Header.Get("Authorization")
			json.NewDecoder(r.Body).Decode(&got)
			w.Write(pcm)
		default:
			t.Errorf("unexpected %s", r.URL)
		}
	}))
}

func TestHostedProviders(t *testing.T) {
	a, _, dir := newTestApp(t)
	got := map[string]any{}
	srv := fakeHosted(t, got)
	defer srv.Close()
	t.Setenv("ELEVENLABS_BASE_URL", srv.URL)
	t.Setenv("OPENAI_BASE_URL", srv.URL)

	req := narrationRequest{ID: "e1", Text: "[excited] It is (((fast))) <laugh> now", Voice: voice{Provider: "elevenlabs", Speaker: "sarah", Model: defaultTTSModel}}
	if _, err := a.synthesize(dir, req); err == nil || !strings.Contains(err.Error(), "ELEVENLABS_API_KEY") {
		t.Fatalf("without a key: %v", err)
	}
	t.Setenv("ELEVENLABS_API_KEY", "eleven-key")
	c, err := a.synthesize(dir, req)
	if err != nil || c.Duration != 500 {
		t.Fatalf("elevenlabs: %+v %v", c, err)
	}
	if got["path"] != "/v1/text-to-speech/aaaaaaaaaaaaaaaaaaaa?output_format=pcm_24000" || got["model_id"] != "eleven_multilingual_v2" || got["text"] != "It is fast now" {
		t.Fatalf("elevenlabs request: %v", got)
	}
	if _, err := cachedClip(dir, "e1"); err != nil {
		t.Fatalf("not cached: %v", err)
	}
	req.Voice.Speaker = "Nobody"
	if _, err := a.synthesize(dir, req); err == nil || !strings.Contains(err.Error(), "Available: Sarah") {
		t.Fatalf("unknown voice: %v", err)
	}
	if names, err := a.TTSVoices("elevenlabs"); err != nil || len(names) != 1 || names[0] != "Sarah" {
		t.Fatalf("voices: %v %v", names, err)
	}

	// the key can come from the settings instead
	if err := a.SaveSettings(Settings{TTS: TTSSettings{OpenAI: ProviderSettings{APIKey: "file-key"}}}); err != nil {
		t.Fatal(err)
	}
	c, err = a.synthesize(dir, narrationRequest{ID: "o1", Text: "hi", Voice: voice{Provider: "openai", Speaker: defaultSpeaker, Model: defaultTTSModel, Instruct: "calm", Speed: "1.5"}})
	if err != nil || c.Duration != 500 {
		t.Fatalf("openai: %+v %v", c, err)
	}
	if got["auth"] != "Bearer file-key" || got["voice"] != "alloy" || got["model"] != "gpt-4o-mini-tts" || got["instructions"] != "calm" || got["response_format"] != "pcm" || got["speed"] != 1.5 {
		t.Fatalf("openai request: %v", got)
	}
}

func TestSettings(t *testing.T) {
	a, ev, dir := newTestApp(t)
	s := Settings{CacheDir: filepath.Join(dir, "shared-cache"), Export: ExportSettings{VideoBitrate: 12}}
	s.TTS.Provider = "espeak"
	s.TTS.ElevenLabs.APIKey = "k"
	if err := a.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	if st, err := os.Stat(configFile()); err != nil || (runtime.GOOS != "windows" && st.Mode().Perm() != 0o600) {
		t.Fatalf("config file: %v %v", st.Mode(), err)
	}
	v := a.Settings()
	if v.Settings.TTS.Provider != "espeak" || v.Settings.TTS.ElevenLabs.APIKey != "k" || v.Settings.Export.VideoBitrate != 12 || len(v.Env) != 0 {
		t.Fatalf("settings: %+v", v)
	}
	if cacheDir(dir) != s.CacheDir {
		t.Fatalf("cache dir: %s", cacheDir(dir))
	}
	t.Setenv("ELEVENLABS_API_KEY", "from-env")
	if v := a.Settings(); v.Env["elevenlabs.apiKey"] != "ELEVENLABS_API_KEY" || providerSettings("elevenlabs").APIKey != "from-env" {
		t.Fatalf("env override: %+v", v.Env)
	}
	if err := a.SaveSettings(Settings{TTS: TTSSettings{Provider: "nope"}}); err == nil {
		t.Fatal("unknown provider saved")
	}

	// project settings go to kino.json, keeping keys kino doesn't know
	os.WriteFile(filepath.Join(dir, "kino.json"), []byte(`{"other": 1}`), 0o644)
	p, err := a.SaveProjectSettings(ProjectSettings{TTS: ProjectTTS{Provider: "ElevenLabs", Voice: map[string]string{"speaker": "Rachel", "model": " "}}})
	if err != nil {
		t.Fatal(err)
	}
	if p.Settings.TTS.Provider != "elevenlabs" || p.Settings.TTS.Voice["speaker"] != "Rachel" || len(p.Settings.TTS.Voice) != 1 {
		t.Fatalf("project settings: %+v", p.Settings)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "kino.json"))
	if !strings.Contains(string(b), `"other": 1`) || !strings.Contains(string(b), `"speaker": "Rachel"`) {
		t.Fatalf("kino.json: %s", b)
	}
	// edits on disk (an agent) reach the studio
	os.WriteFile(filepath.Join(dir, "kino.json"), []byte(`{"tts": {"provider": "festival"}}`), 0o644)
	deadline := time.Now().Add(3 * time.Second)
	for a.CurrentProject().Settings.TTS.Provider != "festival" {
		if time.Now().After(deadline) {
			t.Fatal("kino.json edit not picked up")
		}
		time.Sleep(20 * time.Millisecond)
	}
	ev.wait(t, EventProject)
}

// fakeSynth writes a script that records its arguments and stdin, and writes a WAV to the path after -w/-o.
func fakeSynth(t *testing.T, dir, name string) string {
	if runtime.GOOS == "windows" {
		t.Skip("shell script synthesizer")
	}
	wav := filepath.Join(dir, "sample.wav")
	os.WriteFile(wav, pcmWav(16000, 8000), 0o644)
	script := filepath.Join(dir, name)
	os.WriteFile(script, []byte(`#!/bin/sh
echo "$@" > "`+dir+`/args"
cat > "`+dir+`/stdin"
while [ $# -gt 0 ]; do
  case "$1" in -w|-o) cp "`+wav+`" "$2"; shift;; esac
  shift
done
`), 0o755)
	return script
}

func TestClassicSynthesizers(t *testing.T) {
	a, _, dir := newTestApp(t)
	bin := t.TempDir()
	s := Settings{}
	s.TTS.Espeak.Command = fakeSynth(t, bin, "espeak-ng")
	s.TTS.Festival.Command = filepath.Join(bin, "espeak-ng") // same fake
	if err := a.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	read := func(f string) string { b, _ := os.ReadFile(filepath.Join(bin, f)); return strings.TrimSpace(string(b)) }

	c, err := a.synthesize(dir, narrationRequest{ID: "s1", Text: "[joyful] Hola (((amigos)))", Voice: voice{Provider: "espeak", Speaker: defaultSpeaker, Language: "Spanish", Speed: "1.2"}})
	if err != nil || c.Duration != 500 {
		t.Fatalf("espeak: %+v %v", c, err)
	}
	if args := read("args"); !strings.HasPrefix(args, "-v es -s 210 -w ") || !strings.HasSuffix(args, " --stdin") || read("stdin") != "Hola amigos" {
		t.Fatalf("espeak args %q stdin %q", args, read("stdin"))
	}
	if _, err := a.synthesize(dir, narrationRequest{ID: "s2", Text: "x", Voice: voice{Provider: "espeak", Speaker: "-w/etc/x"}}); err == nil {
		t.Fatal("option-like voice name accepted")
	}

	if _, err := a.synthesize(dir, narrationRequest{ID: "s3", Text: "Hello", Voice: voice{Provider: "festival", Speaker: "kal_diphone", Speed: "2"}}); err != nil {
		t.Fatal(err)
	}
	if args := read("args"); !strings.HasPrefix(args, "-eval (voice_kal_diphone) -eval (Parameter.set 'Duration_Stretch 0.500) -o ") {
		t.Fatalf("festival args %q", args)
	}

	s.TTS.Espeak.Command = filepath.Join(bin, "missing")
	a.SaveSettings(s)
	if _, err := a.synthesize(dir, narrationRequest{ID: "s4", Text: "x", Voice: voice{Provider: "espeak"}}); err == nil || !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("missing espeak: %v", err)
	}
}
