package app

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/jespino/kino/internal/terminal"
)

func TestTerminalLaunchModes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses shell scripts as fake agent CLIs")
	}
	for _, tc := range []struct {
		harness string
		resume  bool
		args    string
	}{
		{"claude", false, ""},
		{"claude", true, "--resume"},
		{"codex", true, "resume"},
		{"gemini", true, "--resume"},
	} {
		t.Run(tc.harness+"/"+tc.args, func(t *testing.T) {
			a, ev, dir := newTestApp(t)
			bin := t.TempDir()
			// Record the real command arguments, cwd and Kino environment without
			// contacting an agent service or relying on a local session history.
			script := "#!/bin/sh\nprintf '%s\\n' \"$*\" \"$PWD\" \"$KINO_PROJECT\" \"$KINO_FILE\" > launch.txt\n"
			if err := os.WriteFile(filepath.Join(bin, tc.harness), []byte(script), 0o755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", bin)
			launch := a.StartTerminal
			if tc.resume {
				launch = a.ResumeTerminal
			}
			id, err := launch(tc.harness, 80, 24)
			if err != nil {
				t.Fatal(err)
			}
			exit := ev.wait(t, terminal.EventExit).(map[string]any)
			if exit["id"] != id || exit["code"] != 0 {
				t.Fatalf("unexpected exit: %v", exit)
			}
			got, err := os.ReadFile(filepath.Join(dir, "launch.txt"))
			want := strings.Join([]string{tc.args, dir, dir, filepath.Join(dir, "talk.kino"), ""}, "\n")
			if err != nil || string(got) != want {
				t.Fatalf("launch: %q, %v; want %q", got, err, want)
			}
			if _, err := os.Stat(filepath.Join(dir, "AGENTS.md")); err != nil {
				t.Fatalf("missing agent context: %v", err)
			}
		})
	}
}

func TestResumeUnsupportedHarness(t *testing.T) {
	a, _, _ := newTestApp(t)
	for _, harness := range []string{"shell", "agy", "unknown"} {
		if _, err := a.ResumeTerminal(harness, 80, 24); err == nil {
			t.Fatalf("expected error resuming %s", harness)
		}
	}
	if sessions := a.Terminals(); len(sessions) != 0 {
		t.Fatalf("unsupported resume started sessions: %v", sessions)
	}
}
