package app

// Custom templates live in ~/.kino/templates, next to the built-in ones (the
// examples bundled with the studio):
//
//	~/.kino/templates/<name>.kino        a script
//	~/.kino/templates/<name>/<any>.kino  a script plus the assets it uses
//	                                     (pictures, kino.json...), copied
//	                                     into every project made from it

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Template is a custom template.
type Template struct {
	Name   string `json:"name"`
	Path   string `json:"path"`   // the script
	Folder bool   `json:"folder"` // its folder's assets are copied into new projects
	Source string `json:"source"`
}

// TemplatesView is the custom templates and where they come from.
type TemplatesView struct {
	Dir       string     `json:"dir"`
	Templates []Template `json:"templates"`
}

// templatesDir can be moved for tests.
var templatesDir = func() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".kino", "templates")
}

// Templates lists the custom templates, by name.
func (a *App) Templates() TemplatesView {
	dir := templatesDir()
	view := TemplatesView{Dir: dir, Templates: []Template{}}
	ents, err := os.ReadDir(dir)
	if err != nil {
		return view
	}
	for _, e := range ents {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		t, err := readTemplate(filepath.Join(dir, e.Name()))
		if err == nil {
			view.Templates = append(view.Templates, *t)
		}
	}
	sort.Slice(view.Templates, func(i, j int) bool { return view.Templates[i].Name < view.Templates[j].Name })
	return view
}

func readTemplate(path string) (*Template, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSuffix(filepath.Base(path), ".kino")
	if !st.IsDir() && filepath.Ext(path) != ".kino" {
		return nil, fmt.Errorf("%s is not a .kino script", filepath.Base(path))
	}
	script := path
	if st.IsDir() {
		if script, err = resolveProject(path); err != nil {
			return nil, err
		}
	}
	src, err := os.ReadFile(script)
	if err != nil {
		return nil, err
	}
	return &Template{Name: name, Path: script, Folder: st.IsDir(), Source: string(src)}, nil
}

// customTemplate finds the custom template called name.
func customTemplate(name string) (*Template, error) {
	dir := templatesDir()
	if dir == "" || name == "" || name != filepath.Base(name) || strings.HasPrefix(name, ".") {
		return nil, fmt.Errorf("no template called %q", name)
	}
	for _, p := range []string{filepath.Join(dir, name), filepath.Join(dir, name+".kino")} {
		if t, err := readTemplate(p); err == nil {
			return t, nil
		}
	}
	return nil, fmt.Errorf("no template called %q in %s", name, dir)
}

// copyTemplateAssets copies a folder template's files (everything but its
// scripts and hidden files) into dir, keeping files that are already there.
func copyTemplateAssets(t *Template, dir string) error {
	if !t.Folder {
		return nil
	}
	root := filepath.Dir(t.Path)
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil || rel == "." {
			return err
		}
		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		dst := filepath.Join(dir, rel)
		switch {
		case d.IsDir():
			return os.MkdirAll(dst, 0o755)
		case !d.Type().IsRegular() || (rel == d.Name() && filepath.Ext(rel) == ".kino"):
			return nil
		}
		if _, err := os.Stat(dst); err == nil || !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		return copyFile(path, dst)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
