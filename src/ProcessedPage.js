
/**
 * 
 * Page with processed links, etc., but not ready for display
 * Ready to be inputted to skin formatter
 * 
 **/

const ProcessedPage = class ProcessedPage {
    constructor(title, timestamp, content, categories, members) {
        this.title = title
        this.timestamp = timestamp
        this.content = content
        this.categories = categories
        this.members = members
    }
}

module.exports = ProcessedPage
