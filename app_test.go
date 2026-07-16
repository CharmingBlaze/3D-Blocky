package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDialogPathAuthorization(t *testing.T) {
	app := NewApp()
	selected := filepath.Join(t.TempDir(), "model.obj")

	if app.readAuthorized(selected) {
		t.Fatal("path must not be readable before an open dialog authorizes it")
	}
	if err := app.authorizeRead(selected); err != nil {
		t.Fatalf("authorize read: %v", err)
	}
	if !app.readAuthorized(selected) {
		t.Fatal("selected open path should be readable")
	}

	if app.writeAuthorized(selected) {
		t.Fatal("path must not be writable before a save dialog authorizes it")
	}
	if err := app.authorizeWrite(selected); err != nil {
		t.Fatalf("authorize write: %v", err)
	}
	if !app.writeAuthorized(selected) {
		t.Fatal("selected save path should be writable")
	}
	if !app.writeAuthorized(filepath.Join(filepath.Dir(selected), "model.mtl")) {
		t.Fatal("same-stem companion export should be writable")
	}
	if app.writeAuthorized(filepath.Join(filepath.Dir(selected), "other.obj")) {
		t.Fatal("unselected filename should not be writable")
	}
}

func TestReadFileBase64RequiresAuthorizedPath(t *testing.T) {
	app := NewApp()
	path := filepath.Join(t.TempDir(), "project.quadlo")
	if err := os.WriteFile(path, []byte("quadlo"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	if _, err := app.ReadFileBase64(path); err == nil {
		t.Fatal("unauthorized read should fail")
	}
	if err := app.authorizeRead(path); err != nil {
		t.Fatalf("authorize read: %v", err)
	}
	encoded, err := app.ReadFileBase64(path)
	if err != nil {
		t.Fatalf("authorized read: %v", err)
	}
	if encoded != "cXVhZGxv" {
		t.Fatalf("unexpected base64: %q", encoded)
	}
}
