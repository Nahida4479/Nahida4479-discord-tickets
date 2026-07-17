require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./commands/definitions');

const token = process.env.bot;

if (!token) {
    console.error('Brak tokenu bota. Ustaw zmienna "bot" w pliku .env');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function main() {
    const { application } = await rest.get(Routes.oauth2CurrentApplication());
    await rest.put(Routes.applicationCommands(application.id), { body: commands });
    console.log(`Zarejestrowano ${commands.length} komend globalnych dla aplikacji ${application.id}.`);
}

main().catch((error) => {
    console.error('Nie udalo sie zarejestrowac komend:', error);
    process.exit(1);
});
