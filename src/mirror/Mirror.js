
const fs = require('fs')
const fse = require('fs-extra')
const path = require('path')
const axios = require('axios')
const cheerio = require('cheerio')

const {mkdir, writeStream, pageFilename} = require('./tools')

const Skin = require('./Skin')
const MirrorConfig = require('./MirrorConfig')
const PageBuilder = require('./PageBuilder')
const WordIndexer = require('./WordIndexer')

const RawPage = require('./content/RawPage')
const PageImage = require('./content/PageImage')

const API_ENDPOINT = '/api.php'

const MIRROR_CONFIG_FILENAME = 'mirror.json'

const Mirror = class Mirror {

    constructor(config, dir) {
        this.config = config
        this.dir = dir
        this.axios = axios.create({
            baseURL: this.config.source.url,
        })

        const skin = Skin.load(path.join(this.dir, config.path.skin))
        this.skin = skin
        this.pageBuilder = new PageBuilder(this.config, skin)
        this.wordIndexer = new WordIndexer(this)

        this.rawDir = path.join(this.dir, this.config.path.raw)
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
    
    async updateMetadata() {
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
        this.config.namespace.numbers = Object.entries(namespaces).reduce((a, [value, key]) => (a[key] = parseInt(value), a), {})

        await new RawPage("index", -1, 0, `<html><body><div class="mw-parser-output"><script>location.href = "${this.pageBuilder.makeLink(this.config.meta.mainPage)}";</script></div></body></html>`).write(this.rawDir)

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
            cmcontinue = data.continue ? data.continue.cmcontinue : null
            const result = data.query.categorymembers.map(({title}) => title)
            members.push(...result)
        } while(cmcontinue)
        return members
    }

    async updatePage(title, timestamp, images=true) {
        if(!title) return null
        if(typeof timestamp == 'string') timestamp = new Date(timestamp).getTime()
        else if(typeof timestamp != 'number') timestamp = 0

        const sliced = title.slice(0, title.indexOf(':'))
        const namespace = (title.indexOf(':') && this.config.namespace.numbers[sliced]) ? this.config.namespace.numbers[sliced] : 0
        const isCategory = namespace == 14
        const isFile = namespace == 6

        // Update timestamp if not set
        if(timestamp == 0) {
            try {
                const {data} = await this.axios.get(API_ENDPOINT, {
                    params: {
                        format: 'json',
                        action: 'query',
                        prop: 'revisions',
                        titles: title,
                        rvprop: 'timestamp',
                        formatversion: 2,
                    }
                })
                if(data.query && data.query.pages && data.query.pages.length && data.query.pages.length > 0) {
                    const page = data.query.pages[0]
                    if(page && page.revisions && page.revisions.length && page.revisions.length > 0) {
                        const revision = page.revisions[0]
                        if(revision && revision.timestamp) {
                            timestamp = Date.parse(revision.timestamp)
                        }
                    }
                }
            } catch(e) {
            }
        }

        const {data} = await this.axios.get(API_ENDPOINT, {
            params: {
                format: 'json',
                action: 'parse',
                page: title,
                prop: 'text|categories',
                formatversion: 2,
            }
        })
        if(!data.parse) return null
        
        const categories = (data.parse.categories || []).map(({category}) => category.replace(/\_/g, ' '))
        
        const {text} = data.parse
        const $ = cheerio.load(text)
        $('*').contents().filter((_i, {type}) => type === 'comment').remove()
        if(images) {
            $('img').each(async (_i, img) => {
                const src = img.attribs['src']
                const srcset = img.attribs['srcset']
                if(src) this.downloadImage(src, true)
                if(srcset) {
                    srcset.split(/, +/)
                            .map((s) => s.split(/ +/))
                            .forEach(([src]) => this.downloadImage(src, true))
                }
            })
        }
        const members = []
        if(isCategory) members.push(...await this.getCategoryMembers(title))
        const file = (isFile) ? this.getImageTitle((await this.updateImage(title)).sourceUrl) : null
        const rawPage = new RawPage(title, namespace, timestamp, $.html().replace(/\n+/g, '\n'), categories, members, file)
        await rawPage.write(this.rawDir)
        const builtPage = await this.pageBuilder.build(rawPage)
        builtPage.write(this.getPagePath(builtPage.title))
        return builtPage
    }

    async fullUpdatePages(namespace, interval, batch, updateImages=true) {
        this.copySkinFiles()
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
            updatedPages.push(...await Promise.all(allPages.map(({title}) => {
                if(updateImages && namespace == 6) this.updateImage(title)
                return this.updatePage(title, null, updateImages)
            })))
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

    async updatePages(interval, batch, rcend, images) {
        this.mkdirs()
        this.copySkinFiles()
        const rcnamespace = this.config.namespace.update.join('|')
        if(rcend != null) {
            rcend = rcend.toString()
            if(rcend.length == 10 || rcend.length == 13) {
                rcend = parseInt(rcend)
            } else if(rcend.length == 8) {
                const date = [rcend.slice(0, 4), rcend.slice(4, 6), rcend.slice(6, 8)].join('-')
                rcend = new Date(date).getTime()
            } else if(rcend.length == 14) {
                const date = [rcend.slice(0, 4), rcend.slice(4, 6), rcend.slice(6, 8)].join('-')
                const time = [rcend.slice(8, 10), rcend.slice(10, 12), rcend.slice(12, 14)].join(':')
                rcend = new Date(date + ' ' + time).getTime()
            } else {
                rcend = Date.parse(rcend)
            }
        }
        if(rcend == null || rcend == NaN) {
            rcend = this.config.lastUpdate
        }
        if(rcend.toString().length == 13) {
            // milliseconds to seconds
            rcend = Math.floor(rcend / 1000)
        }
        
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

    async buildPage(title) {
        const rawPage = await this.loadRawPage(title)
        const builtPage = await this.pageBuilder.build(rawPage)
        builtPage.write(this.getPagePath(builtPage.title))
        return builtPage
    }

    async fullBuildPages() {
        this.copySkinFiles()
        const titles = await this.allTitles()
        return titles.map(async (title) => {
            return await this.buildPage(title)
        }).filter((page) => page)
    }

    async fullBuildIndices() {
        this.mkdirs()
        const titles = await this.allTitles()
        const rawPages = await Promise.all(titles.map((title) => this.loadRawPage(title)))
        const wordCountList = Object.entries(
            (await Promise.all(rawPages.map((rawPage) => this.wordIndexer.buildWordList(rawPage))))
                    .flat()
                    .reduce((acc, [word, i]) => (acc[word] = (acc[word] || 0) + i, acc), {})
        ).filter((entry) => entry && entry.length)
        const counts = (wordCountList).map(([_w, i]) => i)
        const maxCount = Math.max(...counts)
        // const minCount = Math.min(...counts)
        // console.log(maxCount, minCount)
        const filterCount = Math.round(Math.log(maxCount))

        const wordList = wordCountList
                .filter(([_w, i]) => i > filterCount)
                .map(([word]) => word)
        const wordIndices = await this.wordIndexer.build(wordList, rawPages)

        await Promise.all(Object.values(wordIndices).map((wordIndex) => {
            return wordIndex.write(path.join(this.dir, this.config.path.indices))
        }))

        return wordIndices
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
        const src = Object.values(data.query.pages)[0].imageinfo[0].url
        return await this.downloadImage(src, true)
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

    async downloadImage(src, force=false) {
        const sourceUrl = new URL(src, this.config.source.url)
        const destPath = this.getImagePath(sourceUrl)
        if(force || !fs.existsSync(destPath)) {
            mkdir(destPath)
            const {data} = await axios.get(sourceUrl.href, {
                responseType: 'stream',
            })
            await writeStream(destPath, data)
        }
        return new PageImage(sourceUrl, destPath)
    }

    async allTitles() {
        return fs.readdirSync(path.join(this.dir, this.config.path.raw))
                .map((title) => path.join(this.dir, this.config.path.raw, title))
                .filter((filePath) => !fs.statSync(filePath).isDirectory() && filePath.endsWith('.json'))
                .map((filePath) => JSON.parse(fs.readFileSync(filePath)).title)
    }

    async loadRawPage(title) {
        return RawPage.load(title, this.rawDir)
    }

    getPagePath(title) {
        title = pageFilename(title)
        return path.join(this.dir, this.config.path.pages, title + this.config.extension.page)
    }

    getImagePath(src) {
        const sourceUrl = new URL(src, this.config.source.url)
        return path.join(this.dir, this.config.path.images, pageFilename(this.getImageTitle(sourceUrl)))
    }

    getImageTitle(sourceUrl) {
        return sourceUrl.pathname.split('/').slice(2).join('/')
    }
    
    mkdirs() {
        const pages = path.join(this.dir, this.config.path.pages)
        if(!fs.existsSync(pages)) fs.mkdirSync(pages, { recursive: true })
        const raws = path.join(this.dir, this.config.path.raw)
        if(!fs.existsSync(raws)) fs.mkdirSync(raws, { recursive: true })
        const images = path.join(this.dir, this.config.path.images)
        if(!fs.existsSync(images)) fs.mkdirSync(images, { recursive: true })
        const indices = path.join(this.dir, this.config.path.indices)
        if(!fs.existsSync(indices)) fs.mkdirSync(indices, { recursive: true })
    }

    copySkinFiles() {
        this.skin.builds.forEach((file) => {
            const srcFile = path.join(this.dir, this.config.path.skin, file)
            const destFile = path.join(this.dir, file)
            const content = fs.readFileSync(srcFile).toString()
            const built = this.skin.build(file, {site: this.config})
            fs.mkdirSync(path.dirname(destFile), { recursive: true })
            fs.writeFileSync(destFile, built)
        })
        this.skin.files.forEach((file) => {
            fse.copySync(path.join(this.dir, this.config.path.skin, file), path.join(this.dir, file))
        })
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
