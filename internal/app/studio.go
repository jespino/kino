package app

// The studio's /__kino/* endpoints (binary data that doesn't fit the RPC
// calls). They mirror the clip cache in src/node/tts.ts, so the CLI and the
// studio share a project's .kino-cache/tts:
//
//	POST /__kino/narration {requests, generate}  -> {clips: [{id, duration, url}], missing: [id]}
//	GET  /__kino/audio/<id>.wav                   -> cached audio
//	GET  /__kino/tts-health                       -> TTS server status
//	POST /__kino/tts-test {voice, text}           -> audio/wav of a sample line (not cached)
//	GET  /__kino/image?src=<path or url>          -> image bytes (paths stay inside the project)
//	POST /__kino/save?name=<file>                 -> native save dialog, then writes the body

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type voice struct {
	Provider      string `json:"provider"`
	Model         string `json:"model"`
	Speaker       string `json:"speaker"`
	Language      string `json:"language"`
	Instruct      string `json:"instruct"`
	Preset        string `json:"preset"`
	Reference     string `json:"reference"`
	ReferenceText string `json:"referenceText"`
	Speed         string `json:"speed"`
}

type narrationRequest struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	Voice voice  `json:"voice"`
}

type clip struct {
	ID       string `json:"id"`
	Duration int    `json:"duration"` // ms
	URL      string `json:"url"`
}

type call struct {
	done chan struct{}
	clip clip
	err  error
}

var (
	idPattern    = regexp.MustCompile(`^[0-9a-f]+$`)
	audioPattern = regexp.MustCompile(`^/__kino/audio/([0-9a-f]+)\.wav$`)
)

// cacheDir is $KINO_CACHE, the cache folder setting, or the project's .kino-cache; clips live in tts/<id>.wav.
func cacheDir(project string) string {
	if c := os.Getenv("KINO_CACHE"); c != "" {
		return c
	}
	if c := loadSettings().CacheDir; c != "" {
		return expandHome(c)
	}
	return filepath.Join(project, ".kino-cache")
}

// ServeHTTP serves the /__kino/* endpoints.
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := a.serve(w, r); err != nil {
		sendJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}

func (a *App) serve(w http.ResponseWriter, r *http.Request) error {
	path := r.URL.Path
	if path == "/__kino/tts-health" {
		server := a.ttsURL()
		res, err := http.Get(server + "/health")
		if err != nil {
			sendJSON(w, http.StatusOK, map[string]any{"reachable": false, "server": server})
			return nil
		}
		defer res.Body.Close()
		health := map[string]any{}
		_ = json.NewDecoder(res.Body).Decode(&health)
		health["reachable"] = true
		health["server"] = server
		sendJSON(w, http.StatusOK, health)
		return nil
	}
	if path == "/__kino/tts-test" && r.Method == http.MethodPost {
		return a.testVoice(w, r)
	}
	p, err := a.current()
	if err != nil {
		sendJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return nil
	}
	switch {
	case path == "/__kino/narration" && r.Method == http.MethodPost:
		var body struct {
			Requests []narrationRequest `json:"requests"`
			Generate bool               `json:"generate"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return err
		}
		clips, missing := []clip{}, []string{}
		for _, req := range body.Requests {
			if !idPattern.MatchString(req.ID) {
				return fmt.Errorf("bad clip id %q", req.ID)
			}
			var c clip
			var err error
			if body.Generate {
				c, err = a.ensureClip(p.Dir, req)
				if err != nil {
					return err
				}
			} else if c, err = cachedClip(p.Dir, req.ID); err != nil {
				missing = append(missing, req.ID)
				continue
			}
			clips = append(clips, c)
		}
		sendJSON(w, http.StatusOK, map[string]any{"clips": clips, "missing": missing})
	case audioPattern.MatchString(path):
		id := audioPattern.FindStringSubmatch(path)[1]
		file := filepath.Join(cacheDir(p.Dir), "tts", id+".wav")
		if _, err := os.Stat(file); err != nil {
			sendJSON(w, http.StatusNotFound, map[string]string{"error": "not cached"})
			return nil
		}
		w.Header().Set("Content-Type", "audio/wav")
		http.ServeFile(w, r, file)
	case path == "/__kino/image":
		return serveImage(w, p.Dir, r.URL.Query().Get("src"))
	case path == "/__kino/save" && r.Method == http.MethodPost:
		return a.save(w, r, p.Dir)
	default:
		sendJSON(w, http.StatusNotFound, map[string]string{"error": "unknown endpoint"})
	}
	return nil
}

// serveImage serves the bytes for the image widget: a URL, or a path inside the project.
func serveImage(w http.ResponseWriter, dir, src string) error {
	if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
		res, err := http.Get(src)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			sendJSON(w, http.StatusNotFound, map[string]string{"error": "HTTP " + res.Status})
			return nil
		}
		if ct := res.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		_, err = io.Copy(w, res.Body)
		return err
	}
	f := filepath.Join(dir, src)
	if rel, err := filepath.Rel(dir, f); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		sendJSON(w, http.StatusNotFound, map[string]string{"error": "outside the project"})
		return nil
	}
	data, err := os.ReadFile(f)
	if err != nil {
		sendJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return nil
	}
	_, err = w.Write(data)
	return err
}

// save asks where to put an exported file (frame SVG, MP4) and writes the request body there.
// WebKitGTK and WKWebView ignore <a download>, so the desktop studio posts the blob here.
func (a *App) save(w http.ResponseWriter, r *http.Request, dir string) error {
	d := a.nativeDialogs()
	if d == nil {
		sendJSON(w, http.StatusNotImplemented, map[string]string{"error": "no native dialogs in this shell"})
		return nil
	}
	file, err := d.SaveFile("Save", dir, filepath.Base(r.URL.Query().Get("name")))
	if err != nil {
		return err
	}
	if file == "" {
		sendJSON(w, http.StatusOK, map[string]any{"saved": false})
		return nil
	}
	out, err := os.Create(file)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, r.Body); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	sendJSON(w, http.StatusOK, map[string]any{"saved": true, "path": file})
	return nil
}

// cachedClip returns a clip that is already in the cache.
func cachedClip(dir, id string) (clip, error) {
	data, err := os.ReadFile(filepath.Join(cacheDir(dir), "tts", id+".wav"))
	if err != nil {
		return clip{}, err
	}
	d, err := wavDuration(data)
	if err != nil {
		return clip{}, err
	}
	return clip{ID: id, Duration: d, URL: "/__kino/audio/" + id + ".wav"}, nil
}

// ensureClip returns the cached clip, synthesizing it with the TTS server if needed.
// Concurrent calls for the same clip share one request.
func (a *App) ensureClip(dir string, req narrationRequest) (clip, error) {
	if c, err := cachedClip(dir, req.ID); err == nil {
		return c, nil
	}
	a.mu.Lock()
	c, ok := a.inflight[req.ID]
	if !ok {
		c = &call{done: make(chan struct{})}
		a.inflight[req.ID] = c
		go func() {
			c.clip, c.err = a.synthesize(dir, req)
			a.mu.Lock()
			delete(a.inflight, req.ID)
			a.mu.Unlock()
			close(c.done)
		}()
	}
	a.mu.Unlock()
	<-c.done
	return c.clip, c.err
}

func (a *App) synthesize(dir string, req narrationRequest) (clip, error) {
	data, err := a.synthesizeAudio(dir, req)
	if err != nil {
		return clip{}, err
	}
	d, err := wavDuration(data)
	if err != nil {
		return clip{}, err
	}
	cache := filepath.Join(cacheDir(dir), "tts")
	if err := os.MkdirAll(cache, 0o755); err != nil {
		return clip{}, err
	}
	if err := os.WriteFile(filepath.Join(cache, req.ID+".wav"), data, 0o644); err != nil {
		return clip{}, err
	}
	meta, _ := json.MarshalIndent(map[string]any{"text": req.Text, "voice": req.Voice, "duration": d}, "", "  ")
	if err := os.WriteFile(filepath.Join(cache, req.ID+".json"), meta, 0o644); err != nil {
		return clip{}, err
	}
	return clip{ID: req.ID, Duration: d, URL: "/__kino/audio/" + req.ID + ".wav"}, nil
}

// wavDuration returns the duration (ms) of a PCM WAV file from its header.
func wavDuration(buf []byte) (int, error) {
	if len(buf) < 12 || string(buf[0:4]) != "RIFF" || string(buf[8:12]) != "WAVE" {
		return 0, errors.New("not a WAV file")
	}
	var byteRate uint32
	for off := 12; off+8 <= len(buf); {
		id := string(buf[off : off+4])
		size := binary.LittleEndian.Uint32(buf[off+4:])
		if id == "fmt " && off+20 <= len(buf) {
			byteRate = binary.LittleEndian.Uint32(buf[off+16:])
		}
		if id == "data" {
			if byteRate == 0 {
				break
			}
			// streaming writers may leave the size as 0/0xffffffff
			if size == 0 || size == 0xffffffff {
				size = uint32(len(buf) - off - 8)
			}
			return int(float64(size)/float64(byteRate)*1000 + 0.5), nil
		}
		off += 8 + int(size) + int(size%2)
	}
	return 0, errors.New("WAV file without fmt/data chunks")
}

func sendJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}
