
const fs = require('fs')
const path = require('path')
const {mkdir, pageFilename} = require('../tools')

const RAW_FILE_EXTENSION = '.json'
const RAW_TEXT_FILE_EXTENSION = '.txt'

const RawPage = class RawPage {
    constructor(title, namespace, timestamp, text, categories=[], members=[], file=null) {
        this.title = title
        this.namespace = namespace
        this.timestamp = timestamp
        this.text = text
        this.categories = categories
        this.members = members
        this.file = file
    }

    async write(dir) {
        const name = pageFilename(this.title)
        const rawPath = getPath(name, dir)
        const rawTextPath = getTextPath(name, dir)
        mkdir(rawPath)
        mkdir(rawTextPath)

        const {title, namespace, timestamp, categories, members, file, text} = this
        const content = JSON.stringify({title, namespace, timestamp, categories, members, file}, null, 2)
        
        fs.writeFileSync(rawPath, content)
        fs.writeFileSync(rawTextPath, text)
    }

}

RawPage.load = function(name, dir) {
    name = name.replace(/ /g, '_')
    const rawPath = getPath(name, dir)
    const rawTextPath = getTextPath(name, dir)

    const {title, namespace, timestamp, categories, members, file} = JSON.parse(fs.readFileSync(rawPath))
    const text = fs.readFileSync(rawTextPath).toString()

    const rawPage = new RawPage(title, namespace, timestamp, text, categories, members, file)
    return rawPage
}

function getPath(title, basePath) {
    return path.join(basePath, title) + RAW_FILE_EXTENSION
}

function getTextPath(title, basePath) {
    return path.join(basePath, title) + RAW_TEXT_FILE_EXTENSION
}

module.exports = RawPage
