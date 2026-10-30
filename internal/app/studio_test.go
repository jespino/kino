package app

import (
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jespino/kino/internal/agentctx"
)

// pcmWav builds a 16-bit mono WAV of n samples at rate Hz.
func pcmWav(rate, n int) []byte {
	data := n * 2
	b := make([]byte, 44+data)
	copy(b[0:], "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(36+data))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], uint32(rate))
	binary.LittleEndian.PutUint32(b[28:], uint32(rate*2))
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], uint32(data))
	return b
}

func TestWavDuration(t *testing.T) {
	d, err := wavDuration(pcmWav(24000, 36000))
	if err != nil || d != 1500 {
		t.Fatalf("got %d, %v; want 1500", d, err)
	}
	streamed := pcmWav(24000, 12000)
	binary.LittleEndian.PutUint32(streamed[40:], 0xffffffff)
	if d, err := wavDuration(streamed); err != nil || d != 500 {
		t.Fatalf("streamed: got %d, %v; want 500", d, err)
	}
	if _, err := wavDuration([]byte("not audio at all")); err == nil {
		t.Fatal("expected an error for non-WAV data")
	}
}

type events struct {
	mu   sync.Mutex
	list []string
	data []any
}

func (e *events) emit(name string, data any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.list = append(e.list, name)
	e.data = append(e.data, data)
}

func (e *events) wait(t *testing.T, name string) any {
	t.Helper()
	for range 200 {
		e.mu.Lock()
		for i, n := range e.list {
			if n == name {
				d := e.data[i]
				e.list = append(e.list[:i], e.list[i+1:]...)
				e.data = append(e.data[:i], e.data[i+1:]...)
				e.mu.Unlock()
				return d
			}
		}
		e.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("no %s event", name)
	return nil
}

func (e *events) count(name string) int {
	e.mu.Lock()
	defer e.mu.Unlock()
	n := 0
	for _, x := range e.list {
		if x == name {
			n++
		}
	}
	return n
}

// newTestApp opens a fresh project (root/project/talk.kino) with a private recent list.
func newTestApp(t *testing.T) (*App, *events, string) {
	t.Helper()
	root := t.TempDir()
	recentFile = func() string { return filepath.Join(root, "config", "recent.json") }
	configFile = func() string { return filepath.Join(root, "config", "config.json") }
	templatesDir = func() string { return filepath.Join(root, "templates") }
	for _, env := range []string{"KINO_CACHE", "KINO_TTS_URL", "ELEVENLABS_API_KEY", "ELEVENLABS_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL"} {
		t.Setenv(env, "")
	}
	ev := &events{}
	a := New(ev.emit, agentctx.Docs{})
	t.Cleanup(a.Shutdown)
	if _, err := a.NewProject(filepath.Join(root, "project"), "talk", "frame { a: box }\n", ""); err != nil {
		t.Fatal(err)
	}
	ev.wait(t, EventProject)
	return a, ev, filepath.Join(root, "project")
}

func TestProjects(t *testing.T) {
	a, _, dir := newTestApp(t)
	p := a.CurrentProject()
	if p.Path != filepath.Join(dir, "talk.kino") || p.Name != "project" || p.Source != "frame { a: box }\n" {
		t.Fatalf("project: %+v", p)
	}
	if st, err := os.Stat(filepath.Join(dir, "assets")); err != nil || !st.IsDir() {
		t.Fatal("no assets folder")
	}
	if _, err := a.NewProject(dir, "talk", "", ""); err == nil {
		t.Fatal("created over an existing script")
	}
	// a folder with one script opens it; with two it needs project.kino or a choice
	if p, err := a.OpenProject(dir); err != nil || p.Path != filepath.Join(dir, "talk.kino") {
		t.Fatalf("open folder: %v %v", p, err)
	}
	os.WriteFile(filepath.Join(dir, "other.kino"), []byte("frame {}"), 0o644)
	if _, err := a.OpenProject(dir); err == nil || !strings.Contains(err.Error(), "other.kino, talk.kino") {
		t.Fatalf("ambiguous folder: %v", err)
	}
	if _, err := a.OpenProject(filepath.Join(dir, "missing.kino")); err == nil {
		t.Fatal("opened a missing file")
	}
	recent := a.RecentProjects()
	if len(recent) != 1 || recent[0].Name != "project / talk" || !recent[0].Exists {
		t.Fatalf("recent: %+v", recent)
	}
	l, err := a.ListDir(filepath.Dir(dir))
	if err != nil || len(l.Entries) != 2 || l.Entries[0].IsProject || !l.Entries[1].IsProject { // config/, project/
		t.Fatalf("listing: %+v %v", l, err)
	}
	a.CloseProject()
	if a.CurrentProject() != nil {
		t.Fatal("still open")
	}
}

func TestTemplates(t *testing.T) {
	a, _, dir := newTestApp(t)
	tdir := templatesDir()
	if v := a.Templates(); v.Dir != tdir || len(v.Templates) != 0 {
		t.Fatalf("no templates folder: %+v", v)
	}
	// a script, a folder with its assets, and things that aren't templates
	os.MkdirAll(filepath.Join(tdir, "deck", "assets"), 0o755)
	os.MkdirAll(filepath.Join(tdir, "deck", ".kino"), 0o755)
	os.MkdirAll(filepath.Join(tdir, "empty"), 0o755)
	os.WriteFile(filepath.Join(tdir, "intro.kino"), []byte("frame { intro: box }\n"), 0o644)
	os.WriteFile(filepath.Join(tdir, "notes.txt"), []byte("not a template"), 0o644)
	os.WriteFile(filepath.Join(tdir, "deck", "deck.kino"), []byte("frame { deck: box }\n"), 0o644)
	os.WriteFile(filepath.Join(tdir, "deck", "kino.json"), []byte(`{"tts":{"provider":"espeak"}}`), 0o644)
	os.WriteFile(filepath.Join(tdir, "deck", "assets", "logo.png"), []byte("png"), 0o644)
	os.WriteFile(filepath.Join(tdir, "deck", ".kino", "status.json"), []byte("{}"), 0o644)
	v := a.Templates()
	if len(v.Templates) != 2 || v.Templates[0].Name != "deck" || !v.Templates[0].Folder || v.Templates[1].Name != "intro" || v.Templates[1].Folder {
		t.Fatalf("templates: %+v", v.Templates)
	}

	p, err := a.NewProject(filepath.Join(filepath.Dir(dir), "fromdeck"), "", "ignored", "deck")
	if err != nil {
		t.Fatal(err)
	}
	if p.Source != "frame { deck: box }\n" || p.Path != filepath.Join(p.Dir, "fromdeck.kino") || p.Settings.TTS.Provider != "espeak" {
		t.Fatalf("project from a folder template: %+v", p)
	}
	if b, err := os.ReadFile(filepath.Join(p.Dir, "assets", "logo.png")); err != nil || string(b) != "png" {
		t.Fatalf("asset not copied: %v", err)
	}
	for _, f := range []string{"deck.kino", filepath.Join(".kino", "status.json")} {
		if _, err := os.Stat(filepath.Join(p.Dir, f)); err == nil {
			t.Fatalf("%s copied", f)
		}
	}
	if p, err := a.NewProject(filepath.Join(filepath.Dir(dir), "fromintro"), "", "", "intro"); err != nil || p.Source != "frame { intro: box }\n" {
		t.Fatalf("project from a script template: %+v %v", p, err)
	}
	for _, bad := range []string{"missing", "../templates/intro", "notes.txt"} {
		if _, err := a.NewProject(filepath.Join(filepath.Dir(dir), "bad"), "", "", bad); err == nil {
			t.Fatalf("template %q accepted", bad)
		}
	}
}

func TestWatchAndSave(t *testing.T) {
	a, ev, dir := newTestApp(t)
	file := filepath.Join(dir, "talk.kino")
	// our own saves are not echoed back
	if err := a.SaveSource("frame { b: box }\n"); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(file); string(b) != "frame { b: box }\n" {
		t.Fatalf("saved: %q", b)
	}
	// someone else's are
	if err := writeAtomic(file, []byte("frame { c: box }\n")); err != nil {
		t.Fatal(err)
	}
	ch := ev.wait(t, EventSource).(SourceChange)
	if ch.Source != "frame { c: box }\n" || ch.Path != file {
		t.Fatalf("change: %+v", ch)
	}
	time.Sleep(100 * time.Millisecond)
	if n := ev.count(EventSource); n != 0 {
		t.Fatalf("%d extra source events", n)
	}
	if err := a.ReportStatus("frame { c: box }\n", Status{OK: true, Duration: 1000}); err != nil {
		t.Fatal(err)
	}
	var st map[string]any
	b, _ := os.ReadFile(filepath.Join(dir, ".kino", "status.json"))
	if err := json.Unmarshal(b, &st); err != nil || st["file"] != "talk.kino" || st["ok"] != true || len(st["sha256"].(string)) != 64 || st["sheet"] != nil {
		t.Fatalf("status: %s %v", b, err)
	}
	// a sheet of an older source is dropped; one of the reported source is written and noted
	if err := a.ReportSheet("frame {}\n", []byte("old")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".kino", "sheet.png")); !os.IsNotExist(err) {
		t.Fatalf("stale sheet written: %v", err)
	}
	if err := a.ReportSheet("frame { c: box }\n", []byte("png")); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(filepath.Join(dir, ".kino", "status.json"))
	png, _ := os.ReadFile(filepath.Join(dir, ".kino", "sheet.png"))
	if err := json.Unmarshal(b, &st); err != nil || st["sheet"] != ".kino/sheet.png" || string(png) != "png" {
		t.Fatalf("status after sheet: %s %v", b, err)
	}
}

func get(h http.Handler, method, url, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, url, strings.NewReader(body)))
	return w
}

func TestNarrationFromCache(t *testing.T) {
	a, _, dir := newTestApp(t)
	a.tts = "http://127.0.0.1:1"
	cache := filepath.Join(dir, ".kino-cache", "tts")
	if err := os.MkdirAll(cache, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cache, "abc123.wav"), pcmWav(24000, 24000), 0o644); err != nil {
		t.Fatal(err)
	}
	w := get(a, "POST", "/__kino/narration", `{"requests":[{"id":"abc123","text":"hi"},{"id":"def456","text":"bye"}]}`)
	var out struct {
		Clips   []clip   `json:"clips"`
		Missing []string `json:"missing"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err, w.Body.String())
	}
	if len(out.Clips) != 1 || out.Clips[0].Duration != 1000 || out.Clips[0].URL != "/__kino/audio/abc123.wav" {
		t.Fatalf("clips: %+v", out.Clips)
	}
	if len(out.Missing) != 1 || out.Missing[0] != "def456" {
		t.Fatalf("missing: %v", out.Missing)
	}
	if w := get(a, "GET", "/__kino/audio/abc123.wav", ""); w.Code != 200 || w.Header().Get("Content-Type") != "audio/wav" {
		t.Fatalf("audio: %d %s", w.Code, w.Header().Get("Content-Type"))
	}
	// generating with the TTS server down reports why
	w = get(a, "POST", "/__kino/narration", `{"requests":[{"id":"def456","text":"bye"}],"generate":true}`)
	if w.Code != 500 || !strings.Contains(w.Body.String(), "not reachable") {
		t.Fatalf("generate: %d %s", w.Code, w.Body.String())
	}
}

func TestImageStaysInsideProject(t *testing.T) {
	a, _, dir := newTestApp(t)
	if err := os.WriteFile(filepath.Join(dir, "assets", "a.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(dir), "secret.txt"), []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	if w := get(a, "GET", "/__kino/image?src=assets/a.png", ""); w.Code != 200 || w.Body.String() != "png" {
		t.Fatalf("image: %d %q", w.Code, w.Body.String())
	}
	if w := get(a, "GET", "/__kino/image?src=../secret.txt", ""); w.Code != 404 {
		t.Fatalf("escaped the project: %d %q", w.Code, w.Body.String())
	}
	// without native dialogs, saving is left to the browser
	if w := get(a, "POST", "/__kino/save?name=a.svg", "<svg/>"); w.Code != http.StatusNotImplemented {
		t.Fatalf("save: %d", w.Code)
	}
}
