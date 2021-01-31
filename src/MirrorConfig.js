
const fs = require('fs')

const MirrorConfig = class MirrorConfig {
    constructor(sourceUrl='', title='Wiki Mirror') {

        this.source = {
            url: sourceUrl,
            wiki: '/wiki',
            images: '/images',
        }

        this.meta = {
            title: title,
            mainPage: '/MainPage',
            baseUrl: '',
            rights: {
                url: '',
                image: '',
                text: '',
            },
        }

        this.namespace = {
            names: {},
            update: [0, 1, 2, 3, 4, 5, 6, 7, 14, 15],
        }

        this.path = {
            raw: '/raw',
            pages: '/wiki',
            images: '/images',
            skin: '/skin',
        }

        this.extension = {
            page: '.html',
        }

        this.lastUpdate = 0

    }
    json() {
        return JSON.stringify(this, null, 2)
    }
}

MirrorConfig.load = function(file) {
    const json = JSON.parse(fs.readFileSync(file).toString())
    const config = new MirrorConfig()

    if(json.source) config.source = json.source
    if(json.meta) config.meta = json.meta
    if(json.namespace) config.namespace = json.namespace
    if(json.path) config.path = json.path

    if(json.lastUpdate) config.lastUpdate = json.lastUpdate
    
    return config
}

module.exports = MirrorConfig
