
const fs = require('fs')
const path = require('path')

function mkdir(filePath) {
    const dirName = path.dirname(filePath)
    if(!fs.existsSync(dirName)) fs.mkdirSync(dirName, { recursive: true })
}

async function writeStream(destPath, stream) {
    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destPath)
        stream.pipe(writer)
        writer.on('finish', resolve)
        writer.on('error', reject)
    })
}

function pageFilename(name) {
    return name.replace(/ /g, '_')
}

module.exports = {mkdir, writeStream, pageFilename}
