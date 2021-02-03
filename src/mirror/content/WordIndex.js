
const fs = require('fs')
const path = require('path')

const WordIndex = class WordIndex {
    constructor(word) {
        this.word = word
        this.pages = []
    }

    addEntry(title, surrounding) {
        this.pages.push(new PageEntry(title, surrounding))
    }
    
    merge(another) {
        const result = new WordIndex(this.word)
        result.pages.push(...this.pages)
        result.pages.push(...another.pages)
        result.pages = result.pages.filter((page, i, arr) => i === arr.findIndex((p) => p.title == page.title))
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
    constructor(title, surrounding) {
        this.title = title
        this.surrounding = surrounding
    }
}

PageEntry.load = function(data) {
    if(!data.title || !data.surrounding) return null
    return new PageEntry(data.title, data.surrounding)
}

WordIndex.PageEntry = PageEntry

module.exports = WordIndex
