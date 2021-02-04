
const fs = require('fs')
const path = require('path')

const WordIndex = class WordIndex {
    constructor(word) {
        this.word = word
        this.pages = []
    }

    addEntry(title, surrounding) {
        let newEntry = new PageEntry(title, surrounding)
        const foundIndex = this.pages.findIndex((p) => p.title === title)
        if(foundIndex != -1) {
            newEntry = this.pages[foundIndex].merge(newEntry)
            this.pages.splice(foundIndex, 1)
        }
        this.pages.push(newEntry)
    }
    
    merge(another) {
        const result = new WordIndex(this.word)
        const allPages = [...this.pages, ...another.pages]
        const processed = []
        allPages.forEach((page) => {
            if(processed.includes(page.title)) return
            const sameTitle = allPages.filter((p) => p.title == page.title)
            sameTitle.forEach((p) => {
                if(p != page) page = page.merge(p)
            })
            result.pages.push(page)
            processed.push(page.title)
        })
        // if(this.word == '日本') console.log(result.pages) 
        return result
    }

    async write(dir) {
        const filePath = path.join(dir, this.word + '.json')
        fs.writeFileSync(filePath, JSON.stringify(this, null, 2))
    }
}

WordIndex.load = function(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath))
    if(!data.word) return null
    const result = new WordIndex(data.word)
    if(data.pages) result.pages = data.pages.map((d) => PageEntry.load(d)).filter((e) => e != null)
}

const PageEntry = class PageEntry {
    constructor(title, surrounding, count=1) {
        this.title = title
        this.surrounding = surrounding
        this.count = count
    }
    merge(another) {
        return new PageEntry(this.title, this.surrounding + PageEntry.SURROUNDING_SEP + another.surrounding, this.count + another.count)
    }
    shorten() {
        const split = this.surrounding.split(PageEntry.SURROUNDING_SEP)
        if(split.length > 2) {
            this.surrounding = split[0] + PageEntry.SURROUNDING_SEP + split[split.length - 1]
        }
    }
}

PageEntry.SURROUNDING_SEP = ' ... '

PageEntry.load = function(data) {
    if(!data.title || !data.surrounding) return null
    return new PageEntry(data.title, data.surrounding)
}

WordIndex.PageEntry = PageEntry

module.exports = WordIndex
