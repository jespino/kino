// Package server exposes the app service over plain HTTP, mirroring what the
// Wails runtime provides in the desktop shell:
//
//	POST /rpc/<Method>  JSON array of arguments → {"result": …} | {"error": "…"}
//	GET  /events        server-sent events: {"name": …, "data": …}
//	     /__kino/…      binary endpoints (narration audio, images)
//	     /              static frontend
//
// It makes the UI usable in a regular browser for development, and in
// automated tests (parity, end-to-end).
package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"sync"

	"github.com/jespino/kino/internal/app"
)

// Server is an http.Handler.
type Server struct {
	app    *app.App
	static http.Handler
	mux    *http.ServeMux

	mu   sync.Mutex
	subs map[chan []byte]struct{}
}

// New wires the app's emitter to the SSE stream. static serves the frontend
// (may be nil).
func New(a *app.App, static http.Handler) *Server {
	s := &Server{app: a, static: static, mux: http.NewServeMux(), subs: map[chan []byte]struct{}{}}
	a.SetEmitter(s.broadcast)
	s.mux.HandleFunc("POST /rpc/{method}", s.rpc)
	s.mux.HandleFunc("GET /events", s.events)
	s.mux.Handle("/__kino/", a)
	if static != nil {
		s.mux.Handle("/", static)
	}
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

var errType = reflect.TypeFor[error]()

func (s *Server) rpc(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("method")
	m := reflect.ValueOf(s.app).MethodByName(name)
	if !m.IsValid() || name == "ServeHTTP" || name == "SetEmitter" || name == "SetDialogs" || name == "Shutdown" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown method " + name})
		return
	}
	var raw []json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil && !strings.Contains(err.Error(), "EOF") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "arguments must be a JSON array"})
		return
	}
	mt := m.Type()
	if len(raw) != mt.NumIn() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("%s takes %d arguments, got %d", name, mt.NumIn(), len(raw))})
		return
	}
	args := make([]reflect.Value, mt.NumIn())
	for i := range args {
		v := reflect.New(mt.In(i))
		if err := json.Unmarshal(raw[i], v.Interface()); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("argument %d: %v", i, err)})
			return
		}
		args[i] = v.Elem()
	}
	out := m.Call(args)
	var result any
	for _, o := range out {
		if o.Type().Implements(errType) {
			if !o.IsNil() {
				writeJSON(w, http.StatusOK, map[string]string{"error": o.Interface().(error).Error()})
				return
			}
			continue
		}
		result = o.Interface()
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (s *Server) broadcast(name string, data any) {
	msg, err := json.Marshal(map[string]any{"name": name, "data": data})
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subs {
		select {
		case ch <- msg:
		default: // slow client: drop
		}
	}
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	ch := make(chan []byte, 16)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
	}()
	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		}
	}
}
