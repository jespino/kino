// Kino Studio: a desktop app (Wails 3) with a preview, a timeline and an agent
// terminal for Kino projects. The UI is the Vite app in frontend/; this binary
// embeds its build and serves the backend (internal/app).
//
//	kino [project.kino | project folder]     desktop app
//	kino serve [-addr host:port] [project]   the same UI in a browser (development, tests)
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/jespino/kino/internal/agentctx"
	"github.com/jespino/kino/internal/app"
	"github.com/jespino/kino/internal/server"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
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
	if len(os.Args) > 1 && os.Args[1] == "serve" {
		serve(os.Args[2:])
		return
	}
	desktop(os.Args[1:])
}

func newApp() *app.App {
	return app.New(nil, agentctx.Docs{DSL: dslDoc, Skill: skillDoc})
}

func dist() fs.FS {
	d, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	return d
}

func desktop(args []string) {
	svc := newApp()
	wa := application.New(application.Options{
		Name:        "Kino Studio",
		Description: "Describe explanatory animations as text, render them as video",
		Services:    []application.Service{application.NewService(svc)},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(dist()),
			// /__kino/* (narration audio, images, saving) is served by the app
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if len(r.URL.Path) > 8 && r.URL.Path[:8] == "/__kino/" {
						svc.ServeHTTP(w, r)
						return
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		OnShutdown: svc.Shutdown,
		Mac:        application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
	})
	svc.SetEmitter(func(name string, data any) { wa.Event.Emit(name, data) })
	svc.SetDialogs(dialogs{wa})

	wa.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Kino Studio",
		Width:            1600,
		Height:           960,
		BackgroundColour: application.NewRGB(17, 19, 23),
		URL:              "/",
	})

	// A project given on the command line opens directly; otherwise the UI
	// shows the welcome screen (new / open / recent).
	if len(args) > 0 {
		wa.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
			if _, err := svc.OpenProject(args[0]); err != nil {
				wa.Dialog.Error().SetTitle("Cannot open project").SetMessage(err.Error()).Show()
			}
		})
	}
	if err := wa.Run(); err != nil {
		log.Fatal(err)
	}
}

func serve(args []string) {
	flags := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := flags.String("addr", "127.0.0.1:34116", "listen address")
	flags.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: kino serve [-addr host:port] [project.kino | project folder]")
		flags.PrintDefaults()
	}
	flags.Parse(args)
	svc := newApp()
	srv := server.New(svc, http.FileServerFS(dist()))
	if p := flags.Arg(0); p != "" {
		if _, err := svc.OpenProject(p); err != nil {
			log.Fatal(err)
		}
	}
	defer svc.Shutdown()
	log.Printf("Kino Studio on http://%s", *addr)
	log.Fatal(http.ListenAndServe(*addr, srv))
}

// dialogs adapts Wails' native dialogs to app.Dialogs.
type dialogs struct{ wa *application.App }

func (d dialogs) ChooseDirectory(title, start string, canCreate bool) (string, error) {
	dlg := d.wa.Dialog.OpenFile().
		SetTitle(title).
		CanChooseDirectories(true).
		CanChooseFiles(false).
		CanCreateDirectories(canCreate)
	if start != "" {
		dlg.SetDirectory(start)
	}
	if w := d.wa.Window.Current(); w != nil {
		dlg.AttachToWindow(w)
	}
	return dlg.PromptForSingleSelection()
}

func (d dialogs) SaveFile(title, start, name string) (string, error) {
	dlg := d.wa.Dialog.SaveFile().SetFilename(name).CanCreateDirectories(true)
	if ext := filepath.Ext(name); ext != "" {
		dlg.AddFilter(ext[1:]+" files", "*"+ext)
	}
	if start != "" {
		dlg.SetDirectory(start)
	}
	if w := d.wa.Window.Current(); w != nil {
		dlg.AttachToWindow(w)
	}
	return dlg.PromptForSingleSelection()
}
