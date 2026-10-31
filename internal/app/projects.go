package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jespino/kino/internal/agentctx"
	"github.com/jespino/kino/internal/terminal"
)

func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, strings.TrimPrefix(p, "~"))
		}
	}
	return p
}

func trimSlash(s string) string { return strings.TrimRight(s, "/") }

// scripts lists the .kino files directly inside dir.
func scripts(dir string) []string {
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range ents {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".kino" && !strings.HasPrefix(e.Name(), ".") {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

// resolveProject turns a folder or file path into the absolute path of the
// script, with an error a user understands. A folder must hold exactly one
// .kino file, or one named project.kino.
func resolveProject(path string) (string, error) {
	path = expandHome(path)
	st, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("%s does not exist", path)
	}
	if !st.IsDir() {
		if filepath.Ext(path) != ".kino" {
			return "", fmt.Errorf("%s is not a .kino script", filepath.Base(path))
		}
		return filepath.Abs(path)
	}
	found := scripts(path)
	switch {
	case len(found) == 1:
		return filepath.Abs(filepath.Join(path, found[0]))
	case len(found) == 0:
		return "", fmt.Errorf("%s has no .kino script; create a new project there instead", path)
	}
	for _, f := range found {
		if f == "project.kino" {
			return filepath.Abs(filepath.Join(path, f))
		}
	}
	return "", fmt.Errorf("%s has several scripts (%s); open one of them", path, strings.Join(found, ", "))
}

// ---- Recent projects -------------------------------------------------------

const maxRecent = 12

// RecentProject is an entry of the recent list.
type RecentProject struct {
	Path   string    `json:"path"` // the script
	Name   string    `json:"name"`
	Opened time.Time `json:"opened"`
	Exists bool      `json:"exists"`
}

// recentFile can be moved for tests.
var recentFile = func() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "kino", "recent.json")
}

func loadRecent() []RecentProject {
	var list []RecentProject
	if f := recentFile(); f != "" {
		if b, err := os.ReadFile(f); err == nil {
			json.Unmarshal(b, &list)
		}
	}
	return list
}

func recentName(path string) string {
	name := strings.TrimSuffix(filepath.Base(path), ".kino")
	if dir := filepath.Base(filepath.Dir(path)); name == "project" || name == dir {
		return dir
	} else {
		return dir + " / " + name
	}
}

func rememberProject(path string) {
	f := recentFile()
	if f == "" {
		return
	}
	list := []RecentProject{{Path: path, Name: recentName(path), Opened: time.Now()}}
	for _, r := range loadRecent() {
		if r.Path != path && len(list) < maxRecent {
			list = append(list, r)
		}
	}
	os.MkdirAll(filepath.Dir(f), 0o755)
	if b, err := json.MarshalIndent(list, "", "  "); err == nil {
		os.WriteFile(f, b, 0o644)
	}
}

// RecentProjects lists recently opened projects, newest first.
func (a *App) RecentProjects() []RecentProject {
	list := loadRecent()
	for i := range list {
		_, err := os.Stat(list[i].Path)
		list[i].Exists = err == nil
	}
	return list
}

// ---- Folder browser (for shells without native dialogs) --------------------

// DirEntry is an entry of a folder listing.
type DirEntry struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	IsDir     bool   `json:"isDir"`
	IsProject bool   `json:"isProject"` // a folder holding a .kino script
	IsScript  bool   `json:"isScript"`  // a .kino file
}

// DirListing is the content of a folder.
type DirListing struct {
	Path    string     `json:"path"`
	Parent  string     `json:"parent,omitempty"`
	Scripts []string   `json:"scripts"` // .kino files in this folder
	Entries []DirEntry `json:"entries"`
}

// ListDir lists a folder for the in-app browser ("" = home). Hidden entries
// are skipped; folders come first, and only .kino files are listed.
func (a *App) ListDir(path string) (*DirListing, error) {
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		path = home
	}
	path, err := filepath.Abs(expandHome(path))
	if err != nil {
		return nil, err
	}
	ents, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	out := &DirListing{Path: path, Scripts: scripts(path), Entries: []DirEntry{}}
	if out.Scripts == nil {
		out.Scripts = []string{}
	}
	if parent := filepath.Dir(path); parent != path {
		out.Parent = parent
	}
	for _, e := range ents {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		full := filepath.Join(path, e.Name())
		isDir := e.IsDir()
		if e.Type()&os.ModeSymlink != 0 {
			if st, err := os.Stat(full); err == nil {
				isDir = st.IsDir()
			}
		}
		de := DirEntry{Name: e.Name(), Path: full, IsDir: isDir}
		if isDir {
			de.IsProject = len(scripts(full)) > 0
		} else if filepath.Ext(e.Name()) == ".kino" {
			de.IsScript = true
		} else {
			continue
		}
		out.Entries = append(out.Entries, de)
	}
	sort.Slice(out.Entries, func(i, j int) bool {
		a, b := out.Entries[i], out.Entries[j]
		if a.IsDir != b.IsDir {
			return a.IsDir
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	return out, nil
}

// ---- Native dialogs ----------------------------------------------------------

func (a *App) nativeDialogs() Dialogs {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.dialogs
}

// HasNativeDialogs reports whether ChooseDirectory and file saving use native dialogs.
func (a *App) HasNativeDialogs() bool { return a.nativeDialogs() != nil }

// ChooseDirectory shows a native folder picker ("" if cancelled).
func (a *App) ChooseDirectory(title string, canCreate bool) (string, error) {
	d := a.nativeDialogs()
	if d == nil {
		return "", errors.New("no native dialogs in this shell")
	}
	start := ""
	if p, err := a.current(); err == nil {
		start = filepath.Dir(p.Dir)
	} else if home, err := os.UserHomeDir(); err == nil {
		start = home
	}
	return d.ChooseDirectory(title, start, canCreate)
}

// ---- Agent terminal ----------------------------------------------------------

// Harnesses lists the agent CLIs (and a shell) the terminal panel can run.
func (a *App) Harnesses() []terminal.Harness { return terminal.DefaultHarnesses() }

// StartTerminal runs a harness in the project folder, after writing the
// context files agents read (AGENTS.md, the DSL reference, the skill).
func (a *App) StartTerminal(harness string, cols, rows int) (string, error) {
	return a.startTerminal(harness, cols, rows, false)
}

// ResumeTerminal runs a harness with its native session-resume option.
func (a *App) ResumeTerminal(harness string, cols, rows int) (string, error) {
	return a.startTerminal(harness, cols, rows, true)
}

func (a *App) startTerminal(harness string, cols, rows int, resume bool) (string, error) {
	p, err := a.current()
	if err != nil {
		return "", err
	}
	var h *terminal.Harness
	for _, x := range terminal.DefaultHarnesses() {
		if x.ID == harness {
			h = &x
			break
		}
	}
	if h == nil {
		return "", fmt.Errorf("unknown harness %q", harness)
	}
	if resume {
		resumed, err := h.ForResume()
		if err != nil {
			return "", err
		}
		h = &resumed
	}
	if h.ID != "shell" {
		if err := agentctx.Write(p.Dir, p.Path, a.docs); err != nil {
			return "", fmt.Errorf("writing agent context: %w", err)
		}
	}
	return a.terms.Start(*h, p.Dir, []string{"KINO_PROJECT=" + p.Dir, "KINO_FILE=" + p.Path}, cols, rows)
}

func (a *App) TerminalWrite(id, data string) error            { return a.terms.Write(id, data) }
func (a *App) TerminalResize(id string, cols, rows int) error { return a.terms.Resize(id, cols, rows) }
func (a *App) TerminalBuffer(id string) (string, error)       { return a.terms.Buffer(id) }
func (a *App) StopTerminal(id string) error                   { return a.terms.Stop(id) }
func (a *App) Terminals() []terminal.Info                     { return a.terms.List() }
