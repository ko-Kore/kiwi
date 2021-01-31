
const fs = require('fs')
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
        this.skin = new Skin(path.join(this.dir, config.skinPath))
        this.axios = axios.create({
            baseURL: this.config.sourceUrl,
        })

        this.pagesBaseUrl = this.config.baseUrl + this.config.pagesPath
        this.imagesBaseUrl = this.config.baseUrl + this.config.imagesPath
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
        const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
            params: {
                format: 'json',
                action: 'query',
                meta: 'siteinfo',
                siprop: 'general|namespaces',
            }
        })
        const {general, namespaces} = data.query
        Object.entries(namespaces).forEach(([key, value]) => namespaces[key] = value['*'])

        this.config.mainPage = '/' + general.mainpage
        this.config.namespaces = namespaces

        await this.writeRawPage({title: "index", text: `<html><body><div class="mw-parser-output"><script>location.href = "${this.makeLink(this.config.mainPage)}";</script></div></body></html>`})

    }

    async writeRawPage(rawPage) {
        const rawPath = this.getRawPath(rawPage.title)
        const rawTextPath = this.getRawTextPath(rawPage.title)
        this.mkdir(rawPath)
        this.mkdir(rawTextPath)
        const {title, categories, members, text} = rawPage
        const content = {title, categories, members}
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
            const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
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

    async updatePage(title, images=true) {
        const isCategory = title.indexOf(':') !== -1
                && title.slice(0, title.indexOf(':')) == this.config.namespaces[14]
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
                const sourceUrl = new URL(img.attribs['src'], this.config.sourceUrl)
                const destPath = this.getImagePath(sourceUrl)
                this.downloadImage(sourceUrl.href, destPath)
            })
        }
        const page = {title, text: $.html().replace(/\n+/g, '\n'), categories}
        if(isCategory) page.members = await this.getCategoryMembers(title)
        await this.writeRawPage(page)
        await this.buildPage(page)
        return page
    }

    async fullUpdatePages(namespace, interval, batch, images=true) {
        const updatedPages = []
        let apcontinue = null
        do {
            const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'allpages',
                    aplimit: batch,
                    apnamespace: namespace,
                    apcontinue,
                }
            })
            const titles = data.query.allpages.map(({title}) => title)
            apcontinue = data.continue ? data.continue.apcontinue : null
            updatedPages.push(...await Promise.all(titles.map((title) => this.updatePage(title, images))))
            await this.sleep(interval)
        } while(apcontinue)
        return updatedPages.filter((page) => page)
    }

    async fullUpdateAllNamespaces(interval, batch) {
        this.mkdirs()
        this.config.lastUpdate = new Date().getTime()
        const result = []
        for(let namespace of this.config.pageNamespaces) {
            result.push(...await this.fullUpdatePages(namespace, interval, batch))
        }
        return result
    }

    async updatePages(interval, batch, images) {
        this.mkdirs()
        const rcnamespace = this.config.pageNamespaces.join('|')
        const rcend = Math.floor(this.config.lastUpdate / 1000) // //milliseconds to seconds
        this.config.lastUpdate = new Date().getTime()
        const updatedPages = []
        let rccontinue = null
        do {
            const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'recentchanges',
                    rclimit: batch,
                    rcnamespace,
                    rcend,
                    rccontinue,
                }
            })
            const titles = data.query.recentchanges.map(({title}) => title)
            updatedPages.push(...await Promise.all(titles.map((title) => this.updatePage(title, images))))
            await this.sleep(interval)
        } while(rccontinue)
        return updatedPages.filter((page) => page)
    }

    async buildPage(rawPage) {
        const title = rawPage.title
        const text = rawPage.text.toString()

        const categories = (rawPage.categories || []).map((category) => ({
            name: category.split(':')[1],
            url: this.makeLink(category)
        }))
        const members = (rawPage.members || [])
                .map((m) => ({name: m, url: this.makeLink(m)}))
        
        const page = {title, content: text, categories, members}
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
        const list = fs.readdirSync(path.join(this.dir, this.config.rawsPath))
                .map((title) => [path.join(this.dir, this.config.rawsPath, title), title])
                .filter(([rawPath]) => !fs.statSync(rawPath).isDirectory() && rawPath.endsWith(RAW_FILE_EXTENSION))
                .map(([_rawPath, fileName]) => fileName)
        return list.map(async (fileName) => {
            const data = this.readRawPage(fileName.slice(0, -RAW_FILE_EXTENSION.length))
            return await this.buildPage(data)
        }).filter((page) => page)
    }

    async updateImage(title) {
        const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
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
            const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
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
        const url = new URL(href, this.config.sourceUrl)
        const path = url.pathname.split('/')
        if(path.slice(0, 2).join('/') == this.config.sourceWikiUrl) {
            return this.makeLink(path.slice(2).join('/'))
        } else if(href.slice(0, indexPhp.length) == indexPhp) {
            return url.href
        } else return href
    }

    processImageSrc(src) {
        const url = new URL(src, this.config.sourceUrl)
        const path = url.pathname.split('/')
        if(path.slice(0, 2).join('/') == this.config.sourceImagesUrl) {
            return this.makeImageLink(path.slice(2).join('/'))
        } else return src
    }

    makeLink(title) {
        return combineURLs(this.pagesBaseUrl, title + this.config.pageExtension)
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
        return this.getPath(title, this.config.rawsPath, RAW_FILE_EXTENSION)
    }

    getRawTextPath(title) {
        return this.getPath(title, this.config.rawsPath, RAW_TEXT_FILE_EXTENSION)
    }

    getPagePath(title) {
        return this.getPath(title, this.config.pagesPath, this.config.pageExtension)
    }

    getPath(title, basePath, extension) {
        return path.join(this.dir, basePath, `${title}${extension}`)
    }

    getImagePath(sourceUrl) {
        return path.join(this.dir, this.config.imagesPath, sourceUrl.pathname.split('/').slice(2).join('/'))
    }

    mkdirs() {
        const pages = path.join(this.dir, this.config.pagesPath)
        if(!fs.existsSync(pages)) fs.mkdirSync(pages, { recursive: true })
        const raws = path.join(this.dir, this.config.rawsPath)
        if(!fs.existsSync(raws)) fs.mkdirSync(raws, { recursive: true })
        const images = path.join(this.dir, this.config.imagesPath)
        if(!fs.existsSync(images)) fs.mkdirSync(images, { recursive: true })
    }
    
    mkdir(filePath) {
        const dirName = path.dirname(filePath)
        if(!fs.existsSync(dirName)) fs.mkdirSync(dirName, { recursive: true })
    }

}

Mirror.init = function(url, dir) {
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
