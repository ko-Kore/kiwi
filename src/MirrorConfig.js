
const fs = require('fs')

const MirrorConfig = class MirrorConfig {
    constructor(sourceUrl='', title='Wiki Mirror') {
        this.sourceUrl = new URL(sourceUrl).href
        this.sourceWikiUrl = '/wiki'
        this.sourceImagesUrl = '/images'
        this.mainPage = '/MainPage'
        this.namespaces = {}
        this.pageNamespaces = [0, 1, 2, 3, 4, 5, 6, 7, 14, 15]

        this.title = title
        this.baseUrl = ''
        this.skinPath = 'skin'
        this.lastUpdate = 0

        this.rawsPath = '/raw'
        this.pagesPath = '/wiki'
        this.imagesPath = '/images'
        this.pageExtension = '.html'
    }
    json() {
        return JSON.stringify(this, null, 2)
    }
}

MirrorConfig.load = function(file) {
    const json = JSON.parse(fs.readFileSync(file).toString())
    const config = new MirrorConfig(json.sourceUrl)
    if(json.sourceWikiUrl) config.sourceWikiUrl = json.sourceWikiUrl
    if(json.sourceImagesUrl) config.sourceImagesUrl = json.sourceImagesUrl
    if(json.mainPage) config.mainPage = json.mainPage
    if(json.namespaces) config.namespaces = json.namespaces
    if(json.pageNamespaces) config.pageNamespaces = json.pageNamespaces

    if(json.title) config.title = json.title
    if(json.baseUrl) config.baseUrl = json.baseUrl
    if(json.skinPath) config.skinPath = json.skinPath
    if(json.lastUpdate) config.lastUpdate = json.lastUpdate

    if(json.rawsPath) config.rawsPath = json.rawsPath
    if(json.pagesPath) config.pagesPath = json.pagesPath
    if(json.imagesPath) config.imagesPath = json.imagesPath
    if(json.pageExtension) config.pageExtension = json.pageExtension
    
    return config
}

module.exports = MirrorConfig
