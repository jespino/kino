// Kino Studio: a desktop app (Wails 3) with a preview, a timeline and an agent
// terminal for Kino projects. The UI is the Vite app in frontend/; this binary
// embeds its build and serves the backend (internal/app). The shell is
// agentstudio's desktop package.
//
//	kino [project.kino | project folder]     desktop app
//	kino serve [-addr host:port] [project]   the same UI in a browser (development, tests)
package main

import (
	"embed"
	"io/fs"
	"log"

	"github.com/jespino/agentstudio/desktop"
	"github.com/jespino/kino/internal/agentctx"
	"github.com/jespino/kino/internal/app"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

// Copied into projects for the agent running in the terminal panel.
//
//go:embed docs/DSL.md
var dslDoc []byte

//go:embed .claude/skills/kino/SKILL.md
var skillDoc []byte

func main() {
	dist, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	svc := app.New(nil, agentctx.Docs{DSL: dslDoc, Skill: skillDoc})
	desktop.Main(svc, desktop.Options{
		ID:          "kino",
		Name:        "Kino Studio",
		Description: "Describe explanatory animations as text, render them as video",
		Background:  &desktop.RGB{R: 17, G: 19, B: 23},
		Assets:      dist,
		// narration audio, images, saving
		Routes:    []string{"/__kino/"},
		Open:      func(path string) error { _, err := svc.OpenProject(path); return err },
		Setup:     func(wa *application.App) func() { svc.SetWindows(windows{wa}); return nil },
		ServeAddr: "127.0.0.1:34116",
	})
}

// windows opens the speaker view in its own native window.
type windows struct{ wa *application.App }

func (w windows) OpenWindow(name, title, url string, width, height int) {
	if win, ok := w.wa.Window.GetByName(name); ok {
		win.Show()
		win.Focus()
		return
	}
	w.wa.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             name,
		Title:            title,
		Width:            width,
		Height:           height,
		BackgroundColour: application.NewRGB(17, 19, 23),
		URL:              url,
	})
}
