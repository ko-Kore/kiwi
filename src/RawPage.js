
const fs = require('fs')
const path = require('path')
const {mkdir, pageFilename} = require('./tools')

const RAW_FILE_EXTENSION = '.json'
const RAW_TEXT_FILE_EXTENSION = '.txt'

const RawPage = class RawPage {
    constructor(title, timestamp, text, categories=[], members=[]) {
        this.title = title
        this.timestamp = timestamp
        this.text = text
        this.categories = categories
        this.members = members
    }

    async write(dir) {
        const name = pageFilename(this.title)
        const rawPath = getPath(name, dir)
        const rawTextPath = getTextPath(name, dir)
        mkdir(rawPath)
        mkdir(rawTextPath)

        const {title, timestamp, categories, members, text} = this
        const content = JSON.stringify({title, timestamp, categories, members})
        
        fs.writeFileSync(rawPath, content)
        fs.writeFileSync(rawTextPath, text)
    }

}

RawPage.load = function(name, dir) {
    name = name.replace(/ /g, '_')
    const rawPath = getPath(name, dir)
    const rawTextPath = getTextPath(name, dir)

    const {title, timestamp, categories, members} = JSON.parse(fs.readFileSync(rawPath))
    const text = fs.readFileSync(rawTextPath).toString()

    const rawPage = new RawPage(title, timestamp, text, categories, members)
    return rawPage
}

function getPath(title, basePath) {
    return path.join(basePath, title) + RAW_FILE_EXTENSION
}

function getTextPath(title, basePath) {
    return path.join(basePath, title) + RAW_TEXT_FILE_EXTENSION
}

module.exports = RawPage
