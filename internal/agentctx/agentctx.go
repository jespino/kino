// Package agentctx writes the context files that coding-agent harnesses
// (Claude Code, Codex, Gemini CLI, …) read when they start in a project
// folder, so any agent launched from the studio's terminal knows the Kino DSL
// and how to check its work.
package agentctx

import (
	"bytes"
	"embed"
	"os"
	"path/filepath"
	"strings"
)

//go:embed templates/*
var templates embed.FS

const (
	beginMarker = "<!-- kino:begin (managed by Kino Studio; edits inside this block are overwritten) -->"
	endMarker   = "<!-- kino:end -->"
)

// Docs are the repository documents copied into every project.
type Docs struct {
	DSL   []byte // docs/DSL.md
	Skill []byte // .claude/skills/kino/SKILL.md
}

// Write creates or refreshes the context files in dir for the script file
// (its base name is used in the instructions):
//
//	AGENTS.md                     managed block (user content outside it is kept)
//	CLAUDE.md, GEMINI.md          "@AGENTS.md" import, only if missing
//	.kino/docs/DSL.md             generated
//	.claude/skills/kino/SKILL.md  generated
func Write(dir, file string, docs Docs) error {
	agents, err := templates.ReadFile("templates/AGENTS.md")
	if err != nil {
		return err
	}
	agents = bytes.ReplaceAll(agents, []byte("{{FILE}}"), []byte(filepath.Base(file)))
	if err := writeManaged(filepath.Join(dir, "AGENTS.md"), agents); err != nil {
		return err
	}
	for _, name := range []string{"CLAUDE.md", "GEMINI.md"} {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); os.IsNotExist(err) {
			if err := os.WriteFile(p, []byte("@AGENTS.md\n"), 0o644); err != nil {
				return err
			}
		}
	}
	files := map[string][]byte{
		filepath.Join(dir, ".kino", "docs", "DSL.md"):             docs.DSL,
		filepath.Join(dir, ".claude", "skills", "kino", "SKILL.md"): docs.Skill,
	}
	for p, content := range files {
		if len(content) == 0 {
			continue
		}
		if err := writeIfChanged(p, content); err != nil {
			return err
		}
	}
	return nil
}

func writeIfChanged(p string, content []byte) error {
	if old, err := os.ReadFile(p); err == nil && bytes.Equal(old, content) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, content, 0o644)
}

// writeManaged replaces the Kino block of a file, keeping everything the
// user wrote outside it.
func writeManaged(p string, block []byte) error {
	managed := beginMarker + "\n" + strings.TrimRight(string(block), "\n") + "\n" + endMarker + "\n"
	old, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return os.WriteFile(p, []byte(managed), 0o644)
	}
	if err != nil {
		return err
	}
	s := string(old)
	i := strings.Index(s, beginMarker)
	j := strings.Index(s, endMarker)
	var out string
	if i >= 0 && j > i {
		out = s[:i] + managed + strings.TrimPrefix(s[j+len(endMarker):], "\n")
	} else {
		out = strings.TrimRight(s, "\n") + "\n\n" + managed
	}
	if out == s {
		return nil
	}
	return os.WriteFile(p, []byte(out), 0o644)
}
