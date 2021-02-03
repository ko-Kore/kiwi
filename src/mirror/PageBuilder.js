
const combineURLs = require('axios/lib/helpers/combineURLs')
const cheerio = require('cheerio')

const {pageFilename} = require('./tools')

const ProcessedPage = require('./content/ProcessedPage')
const BuiltPage = require('./content/BuiltPage')

const PageBuilder = class PageBuilder {

    constructor(config, skin) {
        this.config = config
        this.skin = skin

        this.pagesBaseUrl = this.config.meta.baseUrl + this.config.path.pages
        this.imagesBaseUrl = this.config.meta.baseUrl + this.config.path.images
        
    }

    async build(rawPage) {
        const title = rawPage.title
        const timestamp = Math.floor(rawPage.timestamp / 1000) || 0
        const text = rawPage.text.toString()

        const categories = (rawPage.categories || []).map((category) => ({
            name: category.slice(category.indexOf(':') + 1),
            url: this.makeLink(this.config.namespace.names[14] + ':' + category)
        }))
        const members = (rawPage.members || [])
                .map((m) => ({name: m, url: this.makeLink(m)}))
        
        const $ = cheerio.load(text)
        const mwParserOutput = $('.mw-parser-output')

        mwParserOutput.find('a').attr('href', (_i, href) => {
            if(!href) return
            return this.processLink(href)
        })
        mwParserOutput.find('img').attr('src', (_i, src) => {
            if(!src) return null
            return this.processImageSrc(src)
        }).attr('srcset', (_i, srcset) => {
            if(!srcset) return null
            return srcset.split(/, +/)
                    .map((s) => s.split(/ +/))
                    .map((entries) => [this.processImageSrc(entries[0]), ...entries.slice(1)])
                    .map((entries) => entries.join(' '))
                    .join(', ')
        })
        const content = mwParserOutput.html()
        const file = rawPage.file ? `<img src="${this.makeImageSrc(rawPage.file)}">` : null
        const processedPage = new ProcessedPage(title, timestamp, content, categories, members, file)

        const formattedContent = this.skin.formatIndex({site: this.config, page: processedPage})
        const builtPage = new BuiltPage(title, formattedContent)

        return builtPage
    }

    processLink(href) {
        const indexPhp = '/index.php'
        const url = new URL(href, this.config.source.url)
        const path = url.pathname.split('/')
        if(path.slice(0, 2).join('/') == this.config.source.wiki) {
            return this.makeLink(path.slice(2).join('/'))
        } else if(href.slice(0, indexPhp.length) == indexPhp) {
            return url.href
        } else return href
    }

    processImageSrc(src) {
        const url = new URL(src, this.config.source.url)
        const path = url.pathname.split('/')
        if(path.slice(0, 2).join('/') == this.config.source.images) {
            return this.makeImageSrc(path.slice(2).join('/'))
        } else return src
    }

    makeLink(title) {
        return combineURLs(this.pagesBaseUrl, pageFilename(title) + this.config.extension.page)
    }

    makeImageSrc(imagePath) {
        return combineURLs(this.imagesBaseUrl, pageFilename(imagePath))
    }

}

module.exports = PageBuilder
