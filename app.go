package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx            context.Context
	pathMu         sync.RWMutex
	readPaths      map[string]struct{}
	writePathStems map[string]struct{}
}

func NewApp() *App {
	return &App{
		readPaths:      make(map[string]struct{}),
		writePathStems: make(map[string]struct{}),
	}
}

const (
	maxBinaryFileBytes = int64(512 * 1024 * 1024)
	maxTextFileBytes   = int64(256 * 1024 * 1024)
)

func normalizedPath(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", errors.New("file path is empty")
	}
	absolute, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	return strings.ToLower(absolute), nil
}

func pathStem(path string) string {
	return strings.TrimSuffix(path, filepath.Ext(path))
}

func (a *App) authorizeRead(path string) error {
	normalized, err := normalizedPath(path)
	if err != nil {
		return err
	}
	a.pathMu.Lock()
	a.readPaths[normalized] = struct{}{}
	a.pathMu.Unlock()
	return nil
}

func (a *App) authorizeWrite(path string) error {
	normalized, err := normalizedPath(path)
	if err != nil {
		return err
	}
	a.pathMu.Lock()
	a.writePathStems[pathStem(normalized)] = struct{}{}
	a.pathMu.Unlock()
	return nil
}

func (a *App) readAuthorized(path string) bool {
	normalized, err := normalizedPath(path)
	if err != nil {
		return false
	}
	a.pathMu.RLock()
	_, ok := a.readPaths[normalized]
	a.pathMu.RUnlock()
	return ok
}

func (a *App) writeAuthorized(path string) bool {
	normalized, err := normalizedPath(path)
	if err != nil {
		return false
	}
	a.pathMu.RLock()
	_, ok := a.writePathStems[pathStem(normalized)]
	a.pathMu.RUnlock()
	return ok
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func toRuntimeFilters(name string, extensions []string) []runtime.FileFilter {
	patterns := make([]string, len(extensions))
	for i, ext := range extensions {
		ext = strings.TrimPrefix(ext, ".")
		patterns[i] = "*." + ext
	}
	return []runtime.FileFilter{{
		DisplayName: name,
		Pattern:     strings.Join(patterns, ";"),
	}}
}

func (a *App) PickOpenFile(title string, filterName string, extensions []string) (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   title,
		Filters: toRuntimeFilters(filterName, extensions),
	})
	if err != nil || path == "" {
		return path, err
	}
	if err := a.authorizeRead(path); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) PickSaveFile(title string, defaultName string, filterName string, extensions []string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           title,
		DefaultFilename: defaultName,
		Filters:         toRuntimeFilters(filterName, extensions),
	})
	if err != nil || path == "" {
		return path, err
	}
	if err := a.authorizeWrite(path); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) ReadFileBase64(path string) (string, error) {
	if !a.readAuthorized(path) {
		return "", errors.New("file read was not authorized by an open dialog")
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.Size() > maxBinaryFileBytes {
		return "", fmt.Errorf("file is too large: limit is %d bytes", maxBinaryFileBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

func (a *App) WriteFileBase64(path string, encoded string) error {
	if !a.writeAuthorized(path) {
		return errors.New("file write was not authorized by a save dialog")
	}
	if int64(base64.StdEncoding.DecodedLen(len(encoded))) > maxBinaryFileBytes {
		return fmt.Errorf("file is too large: limit is %d bytes", maxBinaryFileBytes)
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (a *App) ReadTextFile(path string) (string, error) {
	if !a.readAuthorized(path) {
		return "", errors.New("file read was not authorized by an open dialog")
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.Size() > maxTextFileBytes {
		return "", fmt.Errorf("file is too large: limit is %d bytes", maxTextFileBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteTextFile(path string, content string) error {
	if !a.writeAuthorized(path) {
		return errors.New("file write was not authorized by a save dialog")
	}
	if int64(len(content)) > maxTextFileBytes {
		return fmt.Errorf("file is too large: limit is %d bytes", maxTextFileBytes)
	}
	return os.WriteFile(path, []byte(content), 0o644)
}
