package main

import (
	"embed"
	"io/fs"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:dist
var embeddedAssets embed.FS

func main() {
	distFS, err := fs.Sub(embeddedAssets, "dist")
	if err != nil {
		log.Fatal(err)
	}

	app := NewApp()

	err = wails.Run(&options.App{
		Title:     "3D Blocky",
		Width:     1440,
		Height:    900,
		MinWidth:  1024,
		MinHeight: 640,
		AssetServer: &assetserver.Options{
			Assets: distFS,
		},
		BackgroundColour: &options.RGBA{R: 18, G: 18, B: 20, A: 255},
		WindowStartState: options.Maximised,
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			Theme:                windows.SystemDefault,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
