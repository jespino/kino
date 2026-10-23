package agentctx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteKeepsUserContent(t *testing.T) {
	dir := t.TempDir()
	docs := Docs{DSL: []byte("# DSL\n"), Skill: []byte("# Skill\n")}
	if err := os.WriteFile(filepath.Join(dir, "AGENTS.md"), []byte("# My notes\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte("mine\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for range 2 { // idempotent
		if err := Write(dir, filepath.Join(dir, "talk.kino"), docs); err != nil {
			t.Fatal(err)
		}
	}
	agents, _ := os.ReadFile(filepath.Join(dir, "AGENTS.md"))
	s := string(agents)
	if !strings.HasPrefix(s, "# My notes\n") || strings.Count(s, beginMarker) != 1 || !strings.Contains(s, "`talk.kino`") {
		t.Fatalf("AGENTS.md:\n%s", s)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "CLAUDE.md")); string(b) != "mine\n" {
		t.Fatalf("CLAUDE.md overwritten: %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "GEMINI.md")); string(b) != "@AGENTS.md\n" {
		t.Fatalf("GEMINI.md: %q", b)
	}
	for p, want := range map[string]string{".kino/docs/DSL.md": "# DSL\n", ".claude/skills/kino/SKILL.md": "# Skill\n"} {
		if b, _ := os.ReadFile(filepath.Join(dir, p)); string(b) != want {
			t.Fatalf("%s: %q", p, b)
		}
	}
}
