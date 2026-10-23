package terminal

import (
	"encoding/base64"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestShellRoundTrip(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/sh")
	}
	var mu sync.Mutex
	var out strings.Builder
	exited := make(chan int, 1)
	m := NewManager(func(name string, data any) {
		switch name {
		case EventData:
			b, _ := base64.StdEncoding.DecodeString(data.(map[string]string)["data"])
			mu.Lock()
			out.Write(b)
			mu.Unlock()
		case EventExit:
			exited <- data.(map[string]any)["code"].(int)
		}
	})
	dir := t.TempDir()
	id, err := m.Start(Harness{ID: "sh", Command: "/bin/sh", Available: true}, dir, []string{"KINO_TEST=hello"}, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	m.Write(id, "echo \"$KINO_TEST from $(pwd)\"; exit 3\n")
	select {
	case code := <-exited:
		if code != 3 {
			t.Fatalf("exit code %d", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shell did not exit")
	}
	mu.Lock()
	defer mu.Unlock()
	if !strings.Contains(out.String(), "hello from "+dir) {
		t.Fatalf("output: %q", out.String())
	}
	buf, _ := m.Buffer(id)
	if raw, _ := base64.StdEncoding.DecodeString(buf); !strings.Contains(string(raw), "hello from") {
		t.Fatal("scrollback missing output")
	}
}

func TestUnavailableHarness(t *testing.T) {
	m := NewManager(nil)
	if _, err := m.Start(Harness{Name: "X", Command: "nope", Available: false}, ".", nil, 80, 24); err == nil {
		t.Fatal("expected error")
	}
}
