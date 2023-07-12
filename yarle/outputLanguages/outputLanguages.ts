export interface LanguageItems {
    
    bold?: string;
    italic?: string;
    highlight?: string;
    strikethrough?: string;        
}

const languageItems = {
    bold: '**',
    italic: '_',
    highlight: '==',
    strikethrough: '~~',         
}

export const getLanguageItems = (): any => {
    return languageItems
}
