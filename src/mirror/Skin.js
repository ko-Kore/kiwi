
const fs = require('fs')
const path = require('path')
const {Liquid} = require('liquidjs')

const SKIN_CONFIG_FILENAME = 'skin.json'

const Skin = class Skin {
    constructor(dir) {
        this.dir = dir
        this.liquid = new Liquid()
        this.index = ''
        this.layouts = {}
        this.builds = []
        this.files = []
    }
    formatIndex(vars) {
        return this.format('index.html', '', vars)
    }
    format(layout, content, vars) {
        const layoutContent = fs.readFileSync(path.join(this.dir, layout)).toString()
        content = this.liquid.parseAndRenderSync(layoutContent, {...vars, content})
        if(this.layouts[layout]) return this.format(this.layouts[layout], content, vars)
        else return content
    }
    build(file, vars) {
        return this.format(file, '', vars)
    }
}

Skin.load = function(dir) {
    const skin = new Skin(dir)
    try {
        const json = fs.readFileSync(path.join(dir, SKIN_CONFIG_FILENAME)).toString()
        const data = JSON.parse(json)
        const {index} = data
        skin.index = fs.readFileSync(path.join(dir, index)).toString()
        if(data.layouts) skin.layouts = data.layouts
        if(data.builds) skin.builds = data.builds
        if(data.files) skin.files = data.files
    } catch(error) {
        console.error(error)
    }
    return skin
}

module.exports = Skin
