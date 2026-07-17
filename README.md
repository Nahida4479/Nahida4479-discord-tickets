# Discord Tickets Bot

Bot Discord napisany w JavaScript (discord.js v14), obsługujący w pełni konfigurowalny system ticketów.

## Funkcje

- Komenda `/panel-tickets` (tylko właściciel serwera lub administrator) uruchamia kreator konfiguracji panelu ticketów:
  - tytuł, treść i stopka embeda,
  - obrazek/gif jako załącznik,
  - do 25 przycisków otwierających tickety, każdy z własną etykietą, emoji, treścią wiadomości, rolami do oznaczenia (ping), rolami/osobami z dostępem oraz kategorią kanałów.
- Po zakończeniu konfiguracji embed z przyciskami zostaje wysłany na kanał, na którym użyto komendy.
- Kliknięcie przycisku prosi użytkownika o powód otwarcia ticketa (formularz), a następnie tworzy prywatny kanał tekstowy widoczny tylko dla autora ticketa oraz osób/ról zdefiniowanych dla danego przycisku.
- Na kanale ticketu wysyłana jest wiadomość z oznaczeniem odpowiednich ról/osób oraz podanym powodem, a nad nią embed z przyciskiem zamknięcia ticketu.
- Zamknięcie ticketu:
  - przez autora ticketu — natychmiastowe,
  - przez administratora/osobę z dostępem — wysyłana jest prośba o potwierdzenie do autora (przyciski Tak/Nie); brak odpowiedzi w ciągu 12 godzin zamyka ticket automatycznie.
- Komenda `/help` opisuje działanie systemu ticketów.
- Dane (panele, przyciski, tickety) przechowywane są w bazie danych Turso (libSQL).

## Wymagania

- Node.js w wersji 18 lub nowszej.
- Aplikacja bota na [Discord Developer Portal](https://discord.com/developers/applications) z włączonym przywilejowanym intencją **Message Content Intent** (zakładka *Bot* → *Privileged Gateway Intents*) — jest ona potrzebna do odczytu załączników (obrazek/gif) podczas konfiguracji panelu.
- Baza danych [Turso](https://turso.tech/) (libSQL).

## Konfiguracja

1. Zainstaluj zależności:

   ```bash
   npm install
   ```

2. Utwórz plik `.env` w głównym katalogu projektu (na podstawie `.env.example`) i uzupełnij go swoimi danymi:

   ```
   bot=TOKEN_TWOJEGO_BOTA_DISCORD
   turso=TOKEN_AUTORYZACYJNY_BAZY_TURSO
   turso_link=ADRES_URL_BAZY_TURSO (np. libsql://nazwa-bazy.turso.io)
   ```

   Nigdy nie umieszczaj tych wartości bezpośrednio w kodzie ani nie commituj pliku `.env` — jest on ignorowany przez `.gitignore`.

3. Zarejestruj komendy slash (globalnie, propagacja do wszystkich serwerów może zająć do godziny):

   ```bash
   npm run deploy
   ```

4. Uruchom bota:

   ```bash
   npm start
   ```

## Uprawnienia bota na serwerze

Bot potrzebuje na serwerze uprawnień: `Zarządzaj kanałami`, `Zarządzaj rolami` (jeśli role z dostępem mają wyższą pozycję niż rola bota, przenieś rolę bota wyżej), `Wysyłanie wiadomości`, `Osadzanie linków`, `Czytanie historii wiadomości` oraz `Używanie komend ukośnika`.

## Struktura projektu

```
src/
  commands/       definicje komend slash oraz logika /help
  database/       połączenie z Turso i operacje na danych
  tickets/        logika tworzenia i zamykania ticketów
  utils/          funkcje pomocnicze (uprawnienia, emoji)
  wizard/         kreator konfiguracji panelu ticketów (/panel-tickets)
  deploy-commands.js  rejestracja komend slash w Discordzie
  index.js        punkt wejścia bota
```

## Jak korzystać z systemu (skrót)

1. Administrator używa `/panel-tickets` i przechodzi przez kreator: embed → obrazek/gif → dodawanie przycisków (etykieta, emoji, treść, role do oznaczenia, role/osoby z dostępem, kategoria) → wysłanie panelu.
2. Użytkownik klika przycisk na panelu, podaje powód otwarcia ticketa.
3. Bot tworzy prywatny kanał widoczny tylko dla autora i zdefiniowanych ról/osób, wysyła wiadomość z oznaczeniami i powodem oraz embed z przyciskiem zamknięcia.
4. Ticket zamyka się na życzenie autora, za jego zgodą po prośbie administratora, albo automatycznie po 12 godzinach braku odpowiedzi na taką prośbę.
