// Package app holds the backend service of Kino Studio. The same struct is
// bound by Wails (desktop) and by the HTTP adapter (kino serve), so the UI
// talks to one API regardless of the shell.
//
// A project is a folder: one .kino script (the whole animation) plus the
// assets it references (images, voice recordings). The studio edits the
// script, an agent in the terminal panel edits it too, and every change on
// disk is pushed to the UI.
package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"
	"github.com/jespino/kino/internal/agentctx"
	"github.com/jespino/kino/internal/terminal"
)

// Events emitted to the frontend.
const (
	EventProject = "project:changed" // payload: *Project (nil when closed)
	EventSource  = "project:source"  // payload: SourceChange (the script changed on disk)
)

// Emitter delivers events to the frontend.
type Emitter func(name string, data any)

// Dialogs are native file dialogs, provided by the desktop shell. In a
// browser (kino serve) there are none and the UI uses its own folder browser.
type Dialogs interface {
	// ChooseDirectory returns "" if the user cancels.
	ChooseDirectory(title, start string, canCreate bool) (string, error)
	// SaveFile returns "" if the user cancels.
	SaveFile(title, start, name string) (string, error)
}

// Project is the open project.
type Project struct {
	Path   string `json:"path"` // the .kino script
	Dir    string `json:"dir"`  // the project folder
	Name   string `json:"name"` // folder name
	Source string `json:"source"`
	// Settings is the project's kino.json (narration provider and default voice).
	Settings ProjectSettings `json:"settings"`
}

// SourceChange is the script's new content after an edit on disk.
type SourceChange struct {
	Path   string `json:"path"`
	Source string `json:"source"`
}

// App is the service bound to the frontend. Exported methods are the API.
type App struct {
	mu        sync.Mutex
	project   *Project
	disk      []byte // the script as last read or written by us
	stopWatch func()
	dialogs   Dialogs
	emit      Emitter
	terms     *terminal.Manager
	docs      agentctx.Docs

	tts      string // TTS server URL for tests ("" = env, settings, default)
	inflight map[string]*call
	status   *statusFile // what .kino/status.json holds
}

// New creates the service. docs are copied into projects for agents.
func New(emit Emitter, docs agentctx.Docs) *App {
	if emit == nil {
		emit = func(string, any) {}
	}
	a := &App{emit: emit, docs: docs, inflight: map[string]*call{}}
	a.terms = terminal.NewManager(emit)
	return a
}

// SetEmitter replaces the event sink (the shell creates it after the service).
func (a *App) SetEmitter(emit Emitter) {
	a.mu.Lock()
	a.emit = emit
	a.mu.Unlock()
	a.terms.SetEmitter(emit)
}

// SetDialogs installs native dialogs.
func (a *App) SetDialogs(d Dialogs) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.dialogs = d
}

func (a *App) send(name string, data any) {
	a.mu.Lock()
	emit := a.emit
	a.mu.Unlock()
	emit(name, data)
}

// Shutdown stops terminals and file watching.
func (a *App) Shutdown() {
	a.terms.StopAll()
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.stopWatch != nil {
		a.stopWatch()
		a.stopWatch = nil
	}
}

func (a *App) current() (*Project, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.project == nil {
		return nil, errors.New("no project is open")
	}
	p := *a.project
	return &p, nil
}

// CurrentProject returns the open project with its current script, or nil.
func (a *App) CurrentProject() *Project {
	p, err := a.current()
	if err != nil {
		return nil
	}
	if b, err := os.ReadFile(p.Path); err == nil {
		p.Source = string(b)
	}
	return p
}

// OpenProject opens a .kino script, or a folder holding one.
func (a *App) OpenProject(path string) (*Project, error) {
	file, err := resolveProject(path)
	if err != nil {
		return nil, err
	}
	src, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	dir := filepath.Dir(file)
	p := &Project{Path: file, Dir: dir, Name: filepath.Base(dir), Source: string(src), Settings: readProjectSettings(dir)}
	stop, err := a.watch(p.Path)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	if a.stopWatch != nil {
		a.stopWatch()
	}
	switching := a.project != nil && a.project.Path != p.Path
	a.project, a.disk, a.stopWatch = p, src, stop
	a.mu.Unlock()
	if switching {
		// an agent started for the previous project must not keep editing it
		// from a terminal that now looks like it belongs to this one
		a.terms.StopAll()
	}
	rememberProject(p.Path)
	a.send(EventProject, p)
	return p, nil
}

// CloseProject goes back to the welcome screen.
func (a *App) CloseProject() {
	a.terms.StopAll()
	a.mu.Lock()
	if a.stopWatch != nil {
		a.stopWatch()
	}
	a.project, a.disk, a.stopWatch = nil, nil, nil
	a.mu.Unlock()
	a.send(EventProject, nil)
}

// NewProject creates dir (if needed) with <name>.kino holding source and an
// assets/ folder, and opens it. It fails if the script already exists.
// template names a custom template (see Templates) to start from instead of
// source; a folder template also brings its assets.
func (a *App) NewProject(dir, name, source, template string) (*Project, error) {
	if dir == "" {
		return nil, errors.New("choose a folder for the project")
	}
	dir, err := filepath.Abs(expandHome(dir))
	if err != nil {
		return nil, err
	}
	var tmpl *Template
	if template != "" {
		if tmpl, err = customTemplate(template); err != nil {
			return nil, err
		}
		source = tmpl.Source
	}
	if name == "" {
		name = filepath.Base(dir)
	}
	name = filepath.Base(name)
	if filepath.Ext(name) != ".kino" {
		name += ".kino"
	}
	file := filepath.Join(dir, name)
	if _, err := os.Stat(file); err == nil {
		return nil, fmt.Errorf("%s already exists; open it instead", file)
	}
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		return nil, err
	}
	if tmpl != nil {
		if err := copyTemplateAssets(tmpl, dir); err != nil {
			return nil, fmt.Errorf("copying the template: %w", err)
		}
	}
	if source == "" {
		source = projectTemplate(filepath.Base(dir))
	}
	if err := os.WriteFile(file, []byte(source), 0o644); err != nil {
		return nil, err
	}
	return a.OpenProject(file)
}

// SaveSource writes the script of the open project (the studio's editor).
func (a *App) SaveSource(source string) error {
	p, err := a.current()
	if err != nil {
		return err
	}
	b := []byte(source)
	a.mu.Lock()
	a.disk = b
	a.mu.Unlock()
	return writeAtomic(p.Path, b)
}

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
// Editors often replace files by renaming, so the folder is watched.
func (a *App) watch(file string) (func(), error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := w.Add(filepath.Dir(file)); err != nil {
		w.Close()
		return nil, err
	}
	go func() {
		for {
			select {
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				if !ev.Has(fsnotify.Write | fsnotify.Create | fsnotify.Rename) {
					continue
				}
				switch filepath.Clean(ev.Name) {
				case file:
					a.reload(file)
				case projectSettingsFile(filepath.Dir(file)):
					a.reloadProjectSettings(filepath.Dir(file))
				}
			case _, ok := <-w.Errors:
				if !ok {
					return
				}
			}
		}
	}()
	return func() { w.Close() }, nil
}

func (a *App) reload(file string) {
	b, err := os.ReadFile(file)
	if err != nil {
		return // mid-rename: the Create event that follows reloads it
	}
	a.mu.Lock()
	if a.project == nil || a.project.Path != file || bytes.Equal(b, a.disk) {
		a.mu.Unlock()
		return
	}
	a.disk = b
	a.mu.Unlock()
	a.send(EventSource, SourceChange{Path: file, Source: string(b)})
}

// writeAtomic writes through a temporary file, so watchers never see half a script.
func writeAtomic(path string, b []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	if st, err := os.Stat(path); err == nil {
		os.Chmod(tmp.Name(), st.Mode().Perm())
	} else {
		os.Chmod(tmp.Name(), 0o644)
	}
	return os.Rename(tmp.Name(), path)
}

func projectTemplate(name string) string {
	return fmt.Sprintf(`// %s: a Kino animation. The language reference is docs/DSL.md in the Kino repo.
video { size: (1280, 720), theme: neon }

frame "title" {
  t: title at center() { text: %q, subtitle: "Edit me, or ask the agent" }
}
`, name, name)
}
