
const fs = require('fs')
const fse = require('fs-extra')
const path = require('path')
const axios = require('axios')
const combineURLs = require('axios/lib/helpers/combineURLs')
const cheerio = require('cheerio')

const MirrorConfig = require('./MirrorConfig')
const Skin = require('./Skin')
const { parse } = require('path')

const API_ENDPOINT = '/api.php'

const MIRROR_CONFIG_FILENAME = 'mirror.json'
const RAW_FILE_EXTENSION = '.json'
const RAW_TEXT_FILE_EXTENSION = '.txt'

const Mirror = class Mirror {

    constructor(config, dir) {
        this.config = config
        this.dir = dir
        this.skin = new Skin(path.join(this.dir, config.path.skin))
        this.axios = axios.create({
            baseURL: this.config.source.url,
        })

        this.pagesBaseUrl = this.config.meta.baseUrl + this.config.path.pages
        this.imagesBaseUrl = this.config.meta.baseUrl + this.config.path.images
    }

    sleep(duration) {
        return new Promise((resolve) => {
            setTimeout(() => resolve(), duration)
        })
    }

    writeConfig() {
        if(!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true })
        fs.writeFileSync(path.join(this.dir, MIRROR_CONFIG_FILENAME), this.config.json())
    }
    
    writeMetadata() {
        this.writeConfig()
    }
    
    async updateMeta() {
        this.mkdirs()
        const {data} = await this.axios.get(API_ENDPOINT, {
            params: {
                format: 'json',
                action: 'query',
                meta: 'siteinfo',
                siprop: 'general|namespaces|rightsinfo',
            }
        })
        const {general, namespaces, rightsinfo} = data.query
        Object.entries(namespaces).forEach(([key, value]) => namespaces[key] = value['*'])
        if(rightsinfo.url) this.config.meta.rights.url = rightsinfo.url
        if(rightsinfo.text) this.config.meta.rights.text = rightsinfo.text

        this.config.meta.mainPage = '/' + general.mainpage
        this.config.namespace.names = namespaces

        await this.writeRawPage({title: "index", timestamp: 0, text: `<html><body><div class="mw-parser-output"><script>location.href = "${this.makeLink(this.config.meta.mainPage)}";</script></div></body></html>`})

    }

    async writeRawPage(rawPage) {
        const rawPath = this.getRawPath(rawPage.title)
        const rawTextPath = this.getRawTextPath(rawPage.title)
        this.mkdir(rawPath)
        this.mkdir(rawTextPath)
        const {title, timestamp, categories, members, text} = rawPage
        const content = {title, timestamp, categories, members}
        fs.writeFileSync(rawPath, JSON.stringify(content))
        fs.writeFileSync(rawTextPath, text)
    }

    writePage(title, content) {
        return new Promise((resolve, reject) => {
            const pagePath = this.getPagePath(title)
            this.mkdir(pagePath)
            fs.writeFile(pagePath, content, (error) => {
                if(error) reject(error)
                else resolve()
            })
        })
    }

    downloadImage(sourceUrl, destPath) {
        return new Promise((resolve, reject) => {
            axios.get(sourceUrl, {
                responseType: 'stream',
            }).then(({data}) => {
                this.mkdir(destPath)
                const writer = fs.createWriteStream(destPath)
                data.pipe(writer)
                writer.on('finish', resolve)
                writer.on('error', reject)
            }).catch(reject)
        })
    }

    async getCategoryMembers(cmtitle) {
        const members = []
        let cmcontinue = null
        do {
            const {data} = await this.axios.get(API_ENDPOINT, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'categorymembers',
                    cmtitle,
                    cmcontinue,
                }
            })
            const result = data.query.categorymembers.map(({title}) => title)
            members.push(...result)
        } while(cmcontinue)
        return members
    }

    async updatePage(title, timestamp, images=true) {
        if(!title) return null
        if(typeof timestamp == 'string') timestamp = new Date(timestamp).getTime()
        else if(typeof timestamp != 'number') timestamp = 0
        const isCategory = title.indexOf(':') !== -1
                && title.slice(0, title.indexOf(':')) == this.config.namespace.names[14]
        const {data} = await this.axios.get(API_ENDPOINT, {
            params: {
                format: 'json',
                action: 'parse',
                page: title,
                prop: 'text|categories',
                formatversion: 2,
            }
        })
        const categoriesResult = await this.axios.get(API_ENDPOINT, {
            params: {
                format: 'json',
                action: 'query',
                titles: title,
                prop: 'categories',
            }
        })
        const categories = (Object.values(categoriesResult.data.query.pages)[0].categories || []).map(({title}) => title)
        if(!data.parse) return null
        const {text} = data.parse
        const $ = cheerio.load(text)
        $('*').contents().filter((_i, {type}) => type === 'comment').remove()
        if(images) {
            $('img').each(async (_i, img) => {
                const sourceUrl = new URL(img.attribs['src'], this.config.source.url)
                const destPath = this.getImagePath(sourceUrl)
                this.downloadImage(sourceUrl.href, destPath)
            })
        }
        const page = {title, timestamp, text: $.html().replace(/\n+/g, '\n'), categories}
        if(isCategory) page.members = await this.getCategoryMembers(title)
        await this.writeRawPage(page)
        await this.buildPage(page)
        return page
    }

    async fullUpdatePages(namespace, interval, batch, images=true) {
        const updatedPages = []
        let apcontinue = null
        do {
            const {data} = await this.axios.get(API_ENDPOINT, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'allpages',
                    aplimit: batch,
                    apnamespace: namespace,
                    apcontinue,
                }
            })
            const allPages = data.query.allpages
            apcontinue = data.continue ? data.continue.apcontinue : null
            updatedPages.push(...await Promise.all(allPages.map(({title}) => this.updatePage(title, null, images))))
            await this.sleep(interval)
        } while(apcontinue)
        return updatedPages.filter((page) => page)
    }

    async fullUpdateAllNamespaces(interval, batch) {
        this.mkdirs()
        this.config.lastUpdate = new Date().getTime()
        const result = []
        for(let namespace of this.config.namespace.update) {
            result.push(...await this.fullUpdatePages(namespace, interval, batch))
        }
        return result
    }

    async updatePages(interval, batch, images) {
        this.mkdirs()
        const rcnamespace = this.config.namespace.update.join('|')
        const rcend = Math.floor(this.config.lastUpdate / 1000) // //milliseconds to seconds
        this.config.lastUpdate = new Date().getTime()
        const updatedPages = []
        let rccontinue = null
        do {
            const {data} = await this.axios.get(API_ENDPOINT, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'recentchanges',
                    rcprop: 'title|timestamp',
                    rclimit: batch,
                    rcnamespace,
                    rcend,
                    rccontinue,
                }
            })
            const changes = data.query.recentchanges
            updatedPages.push(...await Promise.all(changes.map(({title, timestamp}) => this.updatePage(title, timestamp, images))))
            await this.sleep(interval)
        } while(rccontinue)
        return updatedPages.filter((page) => page)
    }

    async buildPage(rawPage) {
        const title = rawPage.title
        const timestamp = Math.floor(rawPage.timestamp / 1000) || 0
        const text = rawPage.text.toString()

        const categories = (rawPage.categories || []).map((category) => ({
            name: category.split(':')[1],
            url: this.makeLink(category)
        }))
        const members = (rawPage.members || [])
                .map((m) => ({name: m, url: this.makeLink(m)}))
        
        const page = {title, timestamp, content: text, categories, members}
        const $ = cheerio.load(text)
        const mwParserOutput = $('.mw-parser-output')

        mwParserOutput.find('a').attr('href', (_i, href) => {
            if(!href) return
            return this.processLink(href)
        })
        mwParserOutput.find('img').attr('src', (_i, src) => {
            if(!src) return
            return this.processImageSrc(src)
        })
        page.content = mwParserOutput.html().replace(/\r?\n\r?\n/g, '\n')
        page.content = this.skin.formatIndex({site: this.config, page})

        return await this.writePage(title, page.content)
    }

    async buildPageWithTitle(title) {
        const data = this.readRawPage(title)
        return await this.buildPage(JSON.parse(data)).then(resolve).catch(reject)
    }

    async fullBuild() {
        fse.copySync(path.join(this.dir, this.config.path.skin, 'res'), path.join(this.dir, 'res'))
        const list = fs.readdirSync(path.join(this.dir, this.config.path.raw))
                .map((title) => [path.join(this.dir, this.config.path.raw, title), title])
                .filter(([rawPath]) => !fs.statSync(rawPath).isDirectory() && rawPath.endsWith(RAW_FILE_EXTENSION))
                .map(([_rawPath, fileName]) => fileName)
        return list.map(async (fileName) => {
            const data = this.readRawPage(fileName.slice(0, -RAW_FILE_EXTENSION.length))
            return await this.buildPage(data)
        }).filter((page) => page)
    }

    async updateImage(title) {
        const {data} = await this.axios.get(API_ENDPOINT, {
            params: {
                format: 'json',
                action: 'query',
                titles: title,
                prop: 'imageinfo',
                iiprop: 'url',
            }
        })
        const sourceUrl = new URL(Object.values(data.query.pages)[0].imageinfo[0].url)
        const destPath = this.getImagePath(sourceUrl)
        return this.downloadImage(sourceUrl.href, destPath)
    }

    async fullUpdateImages(interval, batch) {
        this.mkdirs()
        const updatedImages = []
        let aicontinue = null
        do {
            const {data} = await this.axios.get(API_ENDPOINT, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'allimages',
                    ailimit: batch,
                    aicontinue,
                }
            })
            const titles = data.query.allimages.map(({title}) => title)
            aicontinue = data.continue ? data.continue.aicontinue : null
            updatedImages.push(...await Promise.all(titles.map((title) => this.updateImage(title))))
            await this.sleep(interval)
        } while(aicontinue)
        return updatedImages
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
            return this.makeImageLink(path.slice(2).join('/'))
        } else return src
    }

    makeLink(title) {
        return combineURLs(this.pagesBaseUrl, title + this.config.extension.page)
    }

    makeImageLink(title) {
        return combineURLs(this.imagesBaseUrl, title)
    }

    readRawPage(title) {
        const path = this.getRawPath(title)
        const textPath = this.getRawTextPath(title)
        const rawPage = JSON.parse(fs.readFileSync(path))
        rawPage.text = fs.readFileSync(textPath).toString()
        return rawPage
    }

    getRawPath(title) {
        return this.getPath(title, this.config.path.raw, RAW_FILE_EXTENSION)
    }

    getRawTextPath(title) {
        return this.getPath(title, this.config.path.raw, RAW_TEXT_FILE_EXTENSION)
    }

    getPagePath(title) {
        return this.getPath(title, this.config.path.pages, this.config.extension.page)
    }

    getPath(title, basePath, extension) {
        return path.join(this.dir, basePath, `${title}${extension}`)
    }

    getImagePath(sourceUrl) {
        return path.join(this.dir, this.config.path.images, sourceUrl.pathname.split('/').slice(2).join('/'))
    }

    mkdirs() {
        const pages = path.join(this.dir, this.config.path.pages)
        if(!fs.existsSync(pages)) fs.mkdirSync(pages, { recursive: true })
        const raws = path.join(this.dir, this.config.path.raw)
        if(!fs.existsSync(raws)) fs.mkdirSync(raws, { recursive: true })
        const images = path.join(this.dir, this.config.path.images)
        if(!fs.existsSync(images)) fs.mkdirSync(images, { recursive: true })
    }
    
    mkdir(filePath) {
        const dirName = path.dirname(filePath)
        if(!fs.existsSync(dirName)) fs.mkdirSync(dirName, { recursive: true })
    }

}

Mirror.init = function(url, dir) {
    url = new URL(url).href
    if(url.endsWith('/')) url = url.slice(0, -1)
    const config = new MirrorConfig(url)
    const mirror = new Mirror(config, dir)
    return mirror
}

Mirror.load = function(dir) {
    const config = MirrorConfig.load(path.join(dir, MIRROR_CONFIG_FILENAME))
    const mirror = new Mirror(config, dir)
    return mirror
}

module.exports = Mirror
