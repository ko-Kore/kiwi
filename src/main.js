
const path = require('path')
const express = require('express')
const Mirror = require('./Mirror')

const args = process.argv.slice(2)

const usage = () => 'main.js [init|fullupdate|fullbuild|serve]'

const DEFAULT_BATCH = 20
const DEFAULT_INTERVAL = 500

if(args.length > 0) {
    const command = args.shift()
    if(command == 'init') {
        if(args.length > 0) {
            const url = args[0]
            const dir = (args.length > 1) ? args[1] : '.'

            const mirror = Mirror.init(url, dir)
            mirror.updateMetadata().then(() => mirror.writeMetadata())
        } else {
            console.log('main js init [url]')
        }

    } else if(command == 'updatemeta') {
        const dir = (args.length > 0) ? args[0] : '.'
        const mirror = Mirror.load(dir)
        mirror.updateMetadata().then(() => {
            console.log('Wiki metadata updated.')
            mirror.writeMetadata()
        }).catch(console.error)

    } else if(command == 'fullupdate') {
        if(args.length > 0) {
            const type = args[0]
            const dir = (args.length > 1) ? args[1] : '.'
            const batch = (args.length > 2) ? parseInt(args[2]) : DEFAULT_BATCH
            const interval = (args.length > 3) ? parseInt(args[3]) : DEFAULT_INTERVAL
            const mirror = Mirror.load(dir)
            console.log(`Full update started.`)
            mirror.updateMetadata().then(() => {
                console.log('Wiki metadata updated.')
                mirror.writeMetadata()
                if(type == 'pages') {
                    mirror.fullUpdateAllNamespaces(interval, batch).then((updatedPages) => {
                        console.log(`${updatedPages.length} pages updated and built.`)
                    }).catch(console.error)
                } else if(type == 'images') {
                    mirror.fullUpdateImages(interval, batch).then((updatedImages) => {
                        console.log(`${updatedImages.length} images updated.`)
                    })
                }
            }).catch(console.error)
        }

    } else if(command == 'update') {
        if(args.length > 0) {
            const dir = (args.length > 1) ? args[1] : '.'
            const batch = (args.length > 2) ? parseInt(args[2]) : DEFAULT_BATCH
            const interval = (args.length > 3) ? parseInt(args[3]) : DEFAULT_INTERVAL
            const timestamp = (args.length > 4) ? args[4] : null
            const mirror = Mirror.load(dir)
            console.log(`update started.`)
            mirror.updatePages(interval, batch, timestamp, true).then((updatedPages) => {
                console.log(`${updatedPages.length} pages updated.`)
                mirror.writeMetadata()
            }).catch(console.error)
        }

    } else if(command == 'fullbuild') {
        const dir = (args.length > 0) ? args[0] : '.'
        const mirror = Mirror.load(dir)
        console.log(`full build started.`)
        mirror.fullBuild().then((builtPages) => {
            console.log(`${builtPages.length} pages built.`)
            mirror.writeMetadata()
        }).catch(console.error)

    } else if(command == 'serve') {
        const dir = (args.length > 0) ? args[0] : '.'
        const port = (args.length > 1) ? args[1] : 8080
        const mirror = Mirror.load(dir)
        const app = express()
        const prefix = mirror.config.meta.baseUrl
        app.use(`${prefix}/`, express.static(mirror.dir, { extensions:['html'] }))
        app.use(`${prefix}/*`, (req, res, next) => {
            res.status(404)
            res.sendFile(path.resolve(path.join(mirror.dir, '/404.html')))
        })
        app.listen(port)
        
    } else {
        console.log(usage())
    }
} else {
    console.log(usage())
}
