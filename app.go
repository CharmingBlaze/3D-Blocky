package main

import (
	"context"
	"encoding/base64"
	"os"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
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
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   title,
		Filters: toRuntimeFilters(filterName, extensions),
	})
}

func (a *App) PickSaveFile(title string, defaultName string, filterName string, extensions []string) (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           title,
		DefaultFilename: defaultName,
		Filters:         toRuntimeFilters(filterName, extensions),
	})
}

func (a *App) ReadFileBase64(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

func (a *App) WriteFileBase64(path string, encoded string) error {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (a *App) ReadTextFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteTextFile(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}
