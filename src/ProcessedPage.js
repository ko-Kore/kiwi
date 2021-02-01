
/**
 * 
 * Page with processed links, etc., but not ready for display
 * Ready to be inputted to skin formatter
 * 
 **/

const ProcessedPage = class ProcessedPage {
    constructor(title, timestamp, content, categories, members, file) {
        this.title = title
        this.timestamp = timestamp
        this.content = content
        this.categories = categories
        this.members = members
        this.file = file
    }
}

module.exports = ProcessedPage
