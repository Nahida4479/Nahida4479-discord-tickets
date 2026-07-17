const { EmbedBuilder } = require('discord.js');

async function execute(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('System ticketow - jak to dziala')
        .setDescription(
            'Ponizej znajdziesz pelny opis dzialania systemu ticketow na tym serwerze.'
        )
        .addFields(
            {
                name: '1. Konfiguracja panelu (administracja)',
                value:
                    'Osoba z uprawnieniami administratora lub wlasciciel serwera moze uzyc komendy `/panel-tickets`. ' +
                    'Uruchamia to kreator, w ktorym mozna ustawic: tytul embeda, tresc embeda, stopke, ' +
                    'obrazek/gif (jako zalacznik) oraz dowolna liczbe przyciskow (do 25). ' +
                    'Dla kazdego przycisku mozna okreslic: etykiete, emoji, tresc wiadomosci wysylanej po utworzeniu ticketa, ' +
                    'role oznaczane (ping) przy tworzeniu ticketa, role/osoby majace dostep do ticketow z tego przycisku ' +
                    'oraz kategorie, w ktorej beda tworzone kanaly ticketow.',
            },
            {
                name: '2. Wysylka panelu',
                value: 'Po zakonczeniu konfiguracji embed z przyciskami zostaje wyslany na kanal, na ktorym uzyto komendy.',
            },
            {
                name: '3. Tworzenie ticketa',
                value:
                    'Klikniecie przycisku otwiera formularz z pytaniem o powod otwarcia ticketa. ' +
                    'Po jego wypelnieniu bot tworzy nowy kanal w wyznaczonej kategorii, widoczny tylko dla osoby, ' +
                    'ktora otworzyla ticket oraz dla zdefiniowanych dla danego przycisku rol/osob. ' +
                    'Na kanale wysylana jest wiadomosc z oznaczeniem odpowiednich rol/osob oraz podanym powodem.',
            },
            {
                name: '4. Zamykanie ticketa',
                value:
                    'Na gorze kanalu znajduje sie wiadomosc z przyciskiem "Zamknij ticket". ' +
                    'Jesli kliknie go osoba, ktora otworzyla ticket - kanal zamyka sie od razu. ' +
                    'Jesli kliknie go administrator/osoba z dostepem - wysylane jest pytanie do autora ticketa, ' +
                    'czy zgadza sie na zamkniecie (przyciski Tak/Nie). Klikniecie "Tak" zamyka ticket, ' +
                    '"Nie" usuwa pytanie i pozwala kontynuowac rozmowe. Jesli autor nie odpowie w ciagu 12 godzin, ' +
                    'ticket zamknie sie automatycznie.',
            },
            {
                name: '5. Widocznosc ticketow',
                value:
                    'Kazdy przycisk ma wlasna liste rol/osob z dostepem - osoby przypisane tylko do jednego przycisku ' +
                    '(np. "Partnerstwo") nie zobacza ticketow utworzonych przez inny przycisk (np. "Pomoc").',
            }
        )
        .setFooter({ text: 'W razie pytan skontaktuj sie z administracja serwera.' });

    await interaction.reply({ embeds: [embed] });
}

module.exports = { execute };
