package app

// Narration providers, mirroring src/node/tts.ts, picked by the voice's
// `provider`: the local server (tts/server.py), ElevenLabs, OpenAI, or the
// classic espeak-ng / festival installed on this machine. Their keys, URLs and
// commands come from the settings (settings.go).

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Kitten defaults (src/core/narration.ts), replaced by each provider's own.
const (
	defaultTTSModel = "KittenML/kitten-tts-2"
	defaultSpeaker  = "Jasper"
	defaultTTSURL   = "http://127.0.0.1:8808"
	pcmRate         = 24000
)

// ttsURL is the local TTS server: KINO_TTS_URL, the setting, or the default.
func (a *App) ttsURL() string {
	if a.tts != "" {
		return a.tts
	}
	if u := providerSettings("local").URL; u != "" {
		return trimSlash(u)
	}
	return defaultTTSURL
}

// synthesizeAudio returns WAV audio for a request from its provider, without caching it.
func (a *App) synthesizeAudio(dir string, req narrationRequest) ([]byte, error) {
	switch req.Voice.Provider {
	case "elevenlabs":
		return elevenlabs(req)
	case "openai":
		return openai(req)
	case "espeak":
		return espeak(req)
	case "festival":
		return festival(req)
	default:
		return a.localTTS(dir, req)
	}
}

func (a *App) localTTS(dir string, req narrationRequest) ([]byte, error) {
	v := req.Voice
	if v.Reference != "" && !filepath.IsAbs(v.Reference) {
		// the server may run elsewhere: send an absolute path for voice-cloning references
		v.Reference = filepath.Join(dir, v.Reference)
	}
	body, err := json.Marshal(struct {
		Text string `json:"text"`
		voice
	}{req.Text, v})
	if err != nil {
		return nil, err
	}
	server := a.ttsURL()
	res, err := http.Post(server+"/synthesize", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("TTS server not reachable at %s. Start it with `npm run tts` (first time: `npm run tts:setup`)", server)
	}
	return audioBody(req, res)
}

func audioBody(req narrationRequest, res *http.Response) ([]byte, error) {
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		text := []rune(req.Text)
		if len(text) > 40 {
			text = text[:40]
		}
		return nil, fmt.Errorf("TTS failed for %q: %d %s", string(text), res.StatusCode, data)
	}
	return data, nil
}

// hosted returns a hosted provider's key and base URL, failing early without a key or with local-only options.
func hosted(req narrationRequest, name, defaultURL string) (ProviderSettings, error) {
	c := providerSettings(name)
	if c.APIKey == "" {
		return c, fmt.Errorf("%s needs an API key: add it in Settings (or set %s)", name, providerEnv[name+".apiKey"])
	}
	if req.Voice.Reference != "" {
		return c, fmt.Errorf("voice cloning (reference) only works with the local provider; clone the voice in %s and use it as the speaker", name)
	}
	if c.URL == "" {
		c.URL = defaultURL
	}
	c.URL = trimSlash(c.URL)
	return c, nil
}

var (
	stressMarkup = regexp.MustCompile(`\(\(\((.*?)\)\)\)`)
	soundMarkup  = regexp.MustCompile(`(?i)\s*<[a-z]+>\s*`)
	emotionTag   = regexp.MustCompile(`(?i)^\s*\[[a-z]+\]\s*`)
	elevenID     = regexp.MustCompile(`^[A-Za-z0-9]{20}$`)
	voiceNameRe  = regexp.MustCompile(`^[A-Za-z0-9_.+][A-Za-z0-9_.+-]*$`)
)

// spokenText strips Kitten expression markup, like spokenText in src/core/narration.ts.
// keepEmotion leaves a leading [tag] for models that understand it.
func spokenText(text string, keepEmotion bool) string {
	text = stressMarkup.ReplaceAllString(text, "$1")
	if !keepEmotion {
		text = emotionTag.ReplaceAllString(text, "")
	}
	return strings.TrimSpace(soundMarkup.ReplaceAllString(text, " "))
}

// speed is the voice's speed setting, or 0 for the provider's normal rate.
func speed(v voice) float64 {
	s, err := strconv.ParseFloat(strings.TrimSpace(v.Speed), 64)
	if err != nil || s <= 0 || s == 1 {
		return 0
	}
	return s
}

func clamp(x, lo, hi float64) float64 { return min(hi, max(lo, x)) }

// pcmToWav wraps raw 16-bit mono PCM in a WAV header.
func pcmToWav(pcm []byte, rate int) []byte {
	var b bytes.Buffer
	le := func(v any) { _ = binary.Write(&b, binary.LittleEndian, v) }
	b.WriteString("RIFF")
	le(uint32(36 + len(pcm)))
	b.WriteString("WAVEfmt ")
	le(uint32(16))
	le(uint16(1)) // PCM
	le(uint16(1)) // mono
	le(uint32(rate))
	le(uint32(rate * 2))
	le(uint16(2))
	le(uint16(16))
	b.WriteString("data")
	le(uint32(len(pcm)))
	b.Write(pcm)
	return b.Bytes()
}

func postJSON(url string, headers map[string]string, body any) (*http.Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	r, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	r.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	return http.DefaultClient.Do(r)
}

// ---- ElevenLabs ----------------------------------------------------------------

type elevenVoiceInfo struct {
	ID   string `json:"voice_id"`
	Name string `json:"name"`
}

var elevenVoices sync.Map // api key -> []elevenVoiceInfo

func elevenVoiceList(c ProviderSettings) ([]elevenVoiceInfo, error) {
	if v, ok := elevenVoices.Load(c.APIKey); ok {
		return v.([]elevenVoiceInfo), nil
	}
	r, _ := http.NewRequest(http.MethodGet, c.URL+"/v1/voices", nil)
	r.Header.Set("xi-api-key", c.APIKey)
	res, err := http.DefaultClient.Do(r)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(res.Body)
		return nil, fmt.Errorf("ElevenLabs voices: %d %s", res.StatusCode, msg)
	}
	var body struct {
		Voices []elevenVoiceInfo `json:"voices"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, err
	}
	elevenVoices.Store(c.APIKey, body.Voices)
	return body.Voices, nil
}

// elevenVoice resolves a voice name ("Rachel") or id to an ElevenLabs voice id.
func elevenVoice(speaker string, c ProviderSettings) (string, error) {
	if elevenID.MatchString(speaker) {
		return speaker, nil
	}
	voices, err := elevenVoiceList(c)
	if err != nil {
		return "", err
	}
	names := make([]string, len(voices))
	for i, v := range voices {
		names[i] = strings.SplitN(v.Name, " - ", 2)[0]
		if strings.EqualFold(v.Name, speaker) {
			return v.ID, nil
		}
	}
	// names may carry a description: "Sarah - Mature, Reassuring"
	for i, v := range voices {
		if strings.EqualFold(names[i], speaker) {
			return v.ID, nil
		}
	}
	return "", fmt.Errorf("'%s' is not one of your ElevenLabs voices: choose one in Settings → This project (or with speaker: in the script). Available: %s", speaker, strings.Join(names, ", "))
}

func elevenlabs(req narrationRequest) ([]byte, error) {
	c, err := hosted(req, "elevenlabs", "https://api.elevenlabs.io")
	if err != nil {
		return nil, err
	}
	v := req.Voice
	model := v.Model
	if model == "" || model == defaultTTSModel {
		model = "eleven_multilingual_v2"
	}
	// eleven_v3 understands [emotion] tags, like Kitten; older models would read them aloud
	v3 := model == "eleven_v3"
	text := spokenText(req.Text, v3)
	if v3 && v.Instruct != "" && !strings.HasPrefix(text, "[") {
		text = "[" + v.Instruct + "] " + text
	}
	id, err := elevenVoice(v.Speaker, c)
	if err != nil {
		return nil, err
	}
	body := map[string]any{"text": text, "model_id": model}
	if s := speed(v); s != 0 {
		body["voice_settings"] = map[string]float64{"speed": clamp(s, 0.7, 1.2)}
	}
	res, err := postJSON(fmt.Sprintf("%s/v1/text-to-speech/%s?output_format=pcm_%d", c.URL, id, pcmRate),
		map[string]string{"xi-api-key": c.APIKey}, body)
	if err != nil {
		return nil, err
	}
	pcm, err := audioBody(req, res)
	if err != nil {
		return nil, err
	}
	return pcmToWav(pcm, pcmRate), nil
}

// ---- OpenAI ---------------------------------------------------------------------

var openaiVoices = []string{"alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"}

func openai(req narrationRequest) ([]byte, error) {
	c, err := hosted(req, "openai", "https://api.openai.com/v1")
	if err != nil {
		return nil, err
	}
	v := req.Voice
	body := map[string]any{
		"model":           v.Model,
		"voice":           strings.ToLower(v.Speaker),
		"input":           spokenText(req.Text, false),
		"response_format": "pcm", // 24kHz 16-bit mono
	}
	if v.Model == "" || v.Model == defaultTTSModel {
		body["model"] = "gpt-4o-mini-tts"
	}
	if v.Speaker == "" || v.Speaker == defaultSpeaker {
		body["voice"] = "alloy"
	}
	if v.Instruct != "" {
		body["instructions"] = v.Instruct // style direction (gpt-4o-mini-tts)
	}
	if s := speed(v); s != 0 {
		body["speed"] = clamp(s, 0.25, 4)
	}
	res, err := postJSON(c.URL+"/audio/speech", map[string]string{"Authorization": "Bearer " + c.APIKey}, body)
	if err != nil {
		return nil, err
	}
	pcm, err := audioBody(req, res)
	if err != nil {
		return nil, err
	}
	if len(pcm) == 0 {
		return nil, errors.New("openai returned no audio")
	}
	return pcmToWav(pcm, pcmRate), nil
}

// ---- espeak-ng and festival -------------------------------------------------------

// espeak voices by language name; other values (en-us, es, en+f3...) go to espeak as they are
var espeakLanguages = map[string]string{
	"auto": "en", "english": "en", "spanish": "es", "german": "de", "french": "fr", "italian": "it", "portuguese": "pt",
	"russian": "ru", "chinese": "cmn", "japanese": "ja", "korean": "ko", "arabic": "ar", "hindi": "hi", "dutch": "nl", "polish": "pl",
}

// checkVoiceName keeps names that reach a command line to what voice names look like.
func checkVoiceName(name, provider string) (string, error) {
	if !voiceNameRe.MatchString(name) {
		return "", fmt.Errorf("invalid %s voice '%s'", provider, name)
	}
	return name, nil
}

func command(provider, fallback string) string {
	if c := providerSettings(provider).Command; c != "" {
		return c
	}
	return fallback
}

// runToWav runs a synthesizer that writes a WAV file, feeding it the text on stdin.
func runToWav(provider, cmd string, args func(out string) []string, text string) ([]byte, error) {
	dir, err := os.MkdirTemp("", "kino-tts-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	out := filepath.Join(dir, "out.wav")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	c := exec.CommandContext(ctx, cmd, args(out)...)
	c.Stdin = strings.NewReader(text)
	var stderr bytes.Buffer
	c.Stderr = &stderr
	if err := c.Run(); err != nil {
		if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%s is not installed ('%s' not found); install it or set its command in Settings", provider, cmd)
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("%s failed: %s", provider, msg)
	}
	return os.ReadFile(out)
}

func espeak(req narrationRequest) ([]byte, error) {
	v := req.Voice
	name := v.Speaker
	if name == "" || name == defaultSpeaker {
		name = v.Language
		if code, ok := espeakLanguages[strings.ToLower(v.Language)]; ok {
			name = code
		} else if name == "" {
			name = "en"
		}
	}
	name, err := checkVoiceName(name, "espeak")
	if err != nil {
		return nil, err
	}
	wpm := 175.0
	if s := speed(v); s != 0 {
		wpm *= s
	}
	return runToWav("espeak", command("espeak", "espeak-ng"), func(out string) []string {
		return []string{"-v", name, "-s", strconv.Itoa(int(wpm + 0.5)), "-w", out, "--stdin"}
	}, spokenText(req.Text, false))
}

func festival(req narrationRequest) ([]byte, error) {
	v := req.Voice
	var evals []string
	// festival's Scheme names voices voice_<name>: kal_diphone, cmu_us_slt_arctic_hts...
	if v.Speaker != "" && v.Speaker != defaultSpeaker {
		name, err := checkVoiceName(strings.TrimPrefix(v.Speaker, "voice_"), "festival")
		if err != nil {
			return nil, err
		}
		evals = append(evals, "-eval", "(voice_"+name+")")
	}
	if s := speed(v); s != 0 {
		evals = append(evals, "-eval", fmt.Sprintf("(Parameter.set 'Duration_Stretch %.3f)", 1/s))
	}
	return runToWav("festival", command("festival", "text2wave"), func(out string) []string {
		return append(evals, "-o", out)
	}, spokenText(req.Text, false))
}

// ---- voice lists and samples for the settings dialog ------------------------------

// TTSVoices lists the voices a provider offers (also a quick check that it works).
func (a *App) TTSVoices(provider string) ([]string, error) {
	switch provider {
	case "local":
		res, err := http.Get(a.ttsURL() + "/health")
		if err != nil {
			return nil, fmt.Errorf("TTS server not reachable at %s. Start it with `npm run tts`", a.ttsURL())
		}
		defer res.Body.Close()
		var h struct {
			Voices []string `json:"voices"`
		}
		if err := json.NewDecoder(res.Body).Decode(&h); err != nil {
			return nil, err
		}
		return h.Voices, nil
	case "elevenlabs":
		c, err := hosted(narrationRequest{}, "elevenlabs", "https://api.elevenlabs.io")
		if err != nil {
			return nil, err
		}
		voices, err := elevenVoiceList(c)
		if err != nil {
			return nil, err
		}
		names := make([]string, len(voices))
		for i, v := range voices {
			names[i] = strings.SplitN(v.Name, " - ", 2)[0]
		}
		return names, nil
	case "openai":
		return openaiVoices, nil
	case "espeak":
		out, err := exec.Command(command("espeak", "espeak-ng"), "--voices").Output()
		if err != nil {
			return nil, fmt.Errorf("espeak: %v (is espeak-ng installed?)", err)
		}
		// Pty Language Age/Gender VoiceName File Other Languages
		seen := map[string]bool{}
		var names []string
		sc := bufio.NewScanner(bytes.NewReader(out))
		for sc.Scan() {
			f := strings.Fields(sc.Text())
			if len(f) < 2 || f[0] == "Pty" || seen[f[1]] {
				continue
			}
			seen[f[1]] = true
			names = append(names, f[1])
		}
		sort.Strings(names)
		return names, nil
	case "festival":
		// text2wave ships with festival, which can list its voices
		bin := "festival"
		if c := providerSettings("festival").Command; c != "" && filepath.Base(c) == "text2wave" {
			bin = filepath.Join(filepath.Dir(c), "festival")
		}
		out, err := exec.Command(bin, "-b", "(print (voice.list))").Output()
		if err != nil {
			return nil, fmt.Errorf("festival: %v (is festival installed?)", err)
		}
		return strings.Fields(strings.Trim(strings.TrimSpace(string(out)), "()")), nil
	}
	return nil, fmt.Errorf("unknown provider %q", provider)
}

// testVoice synthesizes a sample line with the given voice, without caching it.
func (a *App) testVoice(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Voice voice  `json:"voice"`
		Text  string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return err
	}
	if strings.TrimSpace(body.Text) == "" {
		body.Text = "Hello! This is how the narration will sound."
	}
	dir := ""
	if p, err := a.current(); err == nil {
		dir = p.Dir
	}
	data, err := a.synthesizeAudio(dir, narrationRequest{Text: body.Text, Voice: body.Voice})
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "audio/wav")
	_, err = w.Write(data)
	return err
}
