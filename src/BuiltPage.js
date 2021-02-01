
const fs = require('fs')
const {mkdir} = require('./tools')

const BuiltPage = class BuiltPage {
    constructor(title, content) {
        this.title = title
        this.content = content
    }

    async write(pagePath) {
        mkdir(pagePath)
        const {content} = this
        fs.writeFileSync(pagePath, content)
    }
}

module.exports = BuiltPage
