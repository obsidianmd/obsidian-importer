import { parseHTML } from '../../util';

export function extractDateFromHtml(htmlContent: string): Date | null {
    const doc = parseHTML(htmlContent);

    // Look for the date in the specific div structure
    const dateDiv = doc.querySelector('div.heading');
    if (dateDiv) {
        const dateText = dateDiv.textContent?.trim();

        if (dateText) {
            // Try parsing Korean format
            const koreanMatch = dateText.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})/);
            if (koreanMatch) {
                const [, year, month, day, ampm, hour, minute, second] = koreanMatch;
                let adjustedHour = parseInt(hour);
                if (ampm === '오후' && adjustedHour !== 12) adjustedHour += 12;
                if (ampm === '오전' && adjustedHour === 12) adjustedHour = 0;
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), adjustedHour, parseInt(minute), parseInt(second));
            }

            // Try parsing English format (assuming it might be like "Sep 5, 2024, 5:06:43 PM")
            const englishMatch = dateText.match(/(\w{3})\s*(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i);
            if (englishMatch) {
                const [, month, day, year, hour, minute, second, ampm] = englishMatch;
                const date = new Date(`${month} ${day}, ${year} ${hour}:${minute}:${second} ${ampm}`);
                return date;
            }
        }
    }

    return null;
}