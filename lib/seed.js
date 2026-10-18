'use strict';
// Sample groups with clearly FAKE invite codes. Only inserted when the database is empty and SEED_SAMPLES=1.
const V = require('./validate');
const SEED = [
  ['Anime World JP', 'Anime / Manga', 'Japan', 'Japanese', 'wa', 890, 'All things anime, manga and cosplay: daily recommendations and fan art.'],
  ['Tech Enthusiasts India', 'Science / Tech', 'India', 'English', 'wa', 220, 'Daily discussions on gadgets, software, AI, and everything tech.'],
  ['Study Buddies UK', 'Education', 'United Kingdom', 'English', 'wa', 180, 'University students share notes, resources, and study tips.'],
  ['Lagos Business Network', 'Business / Marketing', 'Nigeria', 'English', 'tg', 410, 'Entrepreneurs and professionals in Lagos connect and grow.'],
  ['Bollywood Fans Club', 'Entertainment', 'India', 'Hindi', 'wa', 530, 'Movies, songs, gossip, and memes: everything Bollywood.'],
  ['FIFA & Football Talk', 'Sports', 'United Kingdom', 'English', 'tg', 295, 'Premier League, Champions League, fantasy football and more.'],
  ['Anime Telegram Hub', 'Anime / Manga', 'Japan', 'Japanese', 'tg', 1200, 'Anime discussion on Telegram: subs, dubs and reviews.'],
  ['Global Music Lovers', 'Music / Audio', 'United States', 'English', 'tg', 340, 'Share music recommendations, playlists, and discover new artists.'],
  ['Fitness & Nutrition', 'Health / Fitness', 'India', 'English', 'wa', 200, 'Workout plans, diet tips, progress pics and motivation.'],
  ['Naija Comedy Hub', 'Entertainment', 'Nigeria', 'English', 'wa', 660, 'Viral memes, funny videos, and comedy skits every day.'],
  ['Dev & Design Chat', 'Science / Tech', 'United States', 'English', 'tg', 450, 'Developers, designers, and product people talking shop.'],
  ['Travel South Asia', 'Travel', 'India', 'English', 'wa', 175, 'Hidden gems, travel tips, and trip planning across South Asia.'],
  ['Manga Collectors', 'Anime / Manga', 'United States', 'English', 'tg', 540, 'Buy, sell, trade manga volumes and talk about your favourite series.'],
  ['Brasil Empreendedores', 'Business / Marketing', 'Brazil', 'Portuguese', 'tg', 310, 'Comunidade de empreendedores, freelancers e startups.'],
  ['Gaming Arena PH', 'Gaming / Apps', 'Philippines', 'English', 'wa', 780, 'Mobile and PC gaming, tournament announcements and squad formation.']
];
function sampleGroups() {
  return SEED.map(([name, cat, country, lang, plat, members, desc], i) => {
    const n = String(i + 1).padStart(4, '0');
    const v = V.normalizeInvite(plat, plat === 'wa' ? `https://chat.whatsapp.com/SAMPLEFAKEGROUPHUB${n}` : `https://t.me/+SAMPLEfakeGROUPHUB${n}`);
    const d = new Date(Date.now() - (i + 1) * 36e5 * 20).toISOString();
    return { name, cat, country, lang, plat, members, desc, link: v.url, linkKey: v.key, status: 'approved', featured: i < 2, sample: true, createdAt: d, updatedAt: d };
  });
}
module.exports = { sampleGroups };
