// Package terminal runs agent harnesses (or a shell) in pseudo-terminals for
// the editor's terminal panel. Output is streamed as events; a scrollback
// buffer lets the panel reattach after a reload.
package terminal

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"sync"

	"github.com/aymanbagabas/go-pty"
)

// Events emitted by the manager.
const (
	EventData = "terminal:data" // {id, data: base64}
	EventExit = "terminal:exit" // {id, code}
)

const scrollback = 512 * 1024

// Harness is a program the panel can launch.
type Harness struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Command    string   `json:"command"`
	Args       []string `json:"args,omitempty"`
	ResumeArgs []string `json:"resumeArgs,omitempty"`
	Available  bool     `json:"available"`
}

// DefaultHarnesses lists the known agent CLIs plus a plain shell.
func DefaultHarnesses() []Harness {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
		if runtime.GOOS == "windows" {
			shell = "powershell.exe"
		}
	}
	hs := []Harness{
		{ID: "claude", Name: "Claude Code", Command: "claude", ResumeArgs: []string{"--resume"}},
		{ID: "codex", Name: "Codex", Command: "codex", ResumeArgs: []string{"resume"}},
		{ID: "gemini", Name: "Gemini CLI", Command: "gemini", ResumeArgs: []string{"--resume"}},
		{ID: "agy", Name: "Antigravity", Command: "agy"},
		{ID: "shell", Name: "Shell", Command: shell},
	}
	for i := range hs {
		_, err := exec.LookPath(hs[i].Command)
		hs[i].Available = err == nil
	}
	return hs
}

// ForResume returns a launch configuration using the CLI's saved sessions.
// Claude and Codex open a picker; Gemini continues the latest session.
func (h Harness) ForResume() (Harness, error) {
	if len(h.ResumeArgs) == 0 {
		return Harness{}, fmt.Errorf("%s does not support resuming sessions", h.Name)
	}
	h.Args = append(append([]string(nil), h.Args...), h.ResumeArgs...)
	return h, nil
}

// Info describes a running session.
type Info struct {
	ID      string `json:"id"`
	Harness string `json:"harness"`
	Running bool   `json:"running"`
}

type session struct {
	info Info
	pty  pty.Pty
	cmd  *pty.Cmd

	mu  sync.Mutex
	buf []byte // scrollback (raw bytes)
}

// Manager owns all terminal sessions.
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*session
	next     int
	emit     func(name string, data any)
}

func NewManager(emit func(name string, data any)) *Manager {
	return &Manager{sessions: map[string]*session{}, emit: emit}
}

// SetEmitter replaces the event sink.
func (m *Manager) SetEmitter(emit func(name string, data any)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.emit = emit
}

func (m *Manager) send(name string, data any) {
	m.mu.Lock()
	emit := m.emit
	m.mu.Unlock()
	if emit != nil {
		emit(name, data)
	}
}

// Start launches h in dir with extra environment variables.
func (m *Manager) Start(h Harness, dir string, env []string, cols, rows int) (string, error) {
	if !h.Available {
		return "", fmt.Errorf("%s (%s) is not installed or not on PATH", h.Name, h.Command)
	}
	p, err := pty.New()
	if err != nil {
		return "", err
	}
	if cols > 0 && rows > 0 {
		p.Resize(cols, rows)
	}
	cmd := p.Command(h.Command, h.Args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), append([]string{"TERM=xterm-256color", "COLORTERM=truecolor"}, env...)...)
	if err := cmd.Start(); err != nil {
		p.Close()
		return "", fmt.Errorf("starting %s: %w", h.Command, err)
	}
	// The child owns the slave end now. Closing our copy makes reads on the
	// master fail once the child exits, which ends the pump.
	if up, ok := p.(pty.UnixPty); ok {
		up.Slave().Close()
	}

	m.mu.Lock()
	m.next++
	id := "t" + strconv.Itoa(m.next)
	s := &session{info: Info{ID: id, Harness: h.ID, Running: true}, pty: p, cmd: cmd}
	m.sessions[id] = s
	m.mu.Unlock()

	go m.pump(s)
	return id, nil
}

func (m *Manager) pump(s *session) {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			s.mu.Lock()
			s.buf = append(s.buf, chunk...)
			if len(s.buf) > scrollback {
				s.buf = s.buf[len(s.buf)-scrollback:]
			}
			s.mu.Unlock()
			m.send(EventData, map[string]string{"id": s.info.ID, "data": base64.StdEncoding.EncodeToString(chunk)})
		}
		if err != nil {
			break
		}
	}
	code := 0
	if err := s.cmd.Wait(); err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			code = ee.ExitCode()
		} else {
			code = -1
		}
	}
	s.pty.Close()
	s.mu.Lock()
	s.info.Running = false
	s.mu.Unlock()
	m.send(EventExit, map[string]any{"id": s.info.ID, "code": code})
}

func (m *Manager) get(id string) (*session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, fmt.Errorf("no terminal %q", id)
	}
	return s, nil
}

// Write sends input (keystrokes, pasted text) to the session.
func (m *Manager) Write(id, data string) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	_, err = s.pty.Write([]byte(data))
	return err
}

// Resize changes the terminal size in character cells.
func (m *Manager) Resize(id string, cols, rows int) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return s.pty.Resize(cols, rows)
}

// Buffer returns the scrollback as base64, for reattaching.
func (m *Manager) Buffer(id string) (string, error) {
	s, err := m.get(id)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return base64.StdEncoding.EncodeToString(s.buf), nil
}

// Stop kills the session's process and forgets it.
func (m *Manager) Stop(id string) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	if s.cmd.Process != nil {
		s.cmd.Process.Kill()
	}
	m.mu.Lock()
	delete(m.sessions, id)
	m.mu.Unlock()
	return nil
}

// List returns all sessions.
func (m *Manager) List() []Info {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Info, 0, len(m.sessions))
	for _, s := range m.sessions {
		s.mu.Lock()
		out = append(out, s.info)
		s.mu.Unlock()
	}
	return out
}

// StopAll kills every session (app shutdown).
func (m *Manager) StopAll() {
	for _, i := range m.List() {
		m.Stop(i.ID)
	}
}
