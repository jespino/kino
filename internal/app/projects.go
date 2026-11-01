package app

import (
	"strings"

	"github.com/jespino/agentstudio/studio"
)

// The project lifecycle, the recent list, the folder browser, native dialogs
// and the agent terminal are studio.Workspace's (embedded in App).

func expandHome(p string) string { return studio.ExpandHome(p) }

func trimSlash(s string) string { return strings.TrimRight(s, "/") }

// resolveProject turns a folder or file path into the absolute path of the
// script. A folder must hold exactly one .kino file, or one named project.kino.
func (a *App) resolveProject(path string) (string, error) { return a.Resolve(path) }

// resolveScript is resolveProject for code without an App (templates).
func resolveScript(path string) (string, error) {
	return studio.New(studio.Config{Ext: ".kino", Default: "project.kino"}).Resolve(path)
}

