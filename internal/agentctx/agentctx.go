// Package agentctx writes the context files that coding-agent harnesses
// (Claude Code, Codex, Gemini CLI, …) read when they start in a project
// folder, so any agent launched from the studio's terminal knows the Kino DSL
// and how to check its work. The writing is agentstudio's agentctx.
package agentctx

import (
	_ "embed"
	"path/filepath"

	shared "github.com/jespino/agentstudio/agentctx"
)

//go:embed templates/AGENTS.md
var agentsTemplate []byte

// Docs are the repository documents copied into every project.
type Docs struct {
	DSL   []byte // docs/DSL.md
	Skill []byte // .claude/skills/kino/SKILL.md
}

// Context is what Write writes for the script file (its base name is used in
// the instructions).
func Context(file string, docs Docs) shared.Context {
	c := shared.Context{
		ID:      "kino",
		Product: "Kino Studio",
		Agents:  shared.Expand(agentsTemplate, map[string]string{"FILE": filepath.Base(file)}),
		Files:   map[string][]byte{".kino/docs/DSL.md": docs.DSL},
	}
	if len(docs.Skill) > 0 {
		c.SkillName, c.Skill = "kino", map[string][]byte{"SKILL.md": docs.Skill}
	}
	return c
}

// Write creates or refreshes the context files in dir:
//
//	AGENTS.md                     managed block (user content outside it is kept)
//	CLAUDE.md, GEMINI.md          "@AGENTS.md" import, only if missing
//	.kino/docs/DSL.md             generated
//	.agents/skills/kino/SKILL.md  generated (Codex, Gemini CLI, Antigravity)
//	.claude/skills/kino/SKILL.md  generated (Claude Code)
func Write(dir, file string, docs Docs) error {
	return shared.Write(dir, Context(file, docs))
}
