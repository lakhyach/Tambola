# Tambola Game

**Tambola** is an interactive, web-based version of the classic Indian game Tambola (also known as Bingo). The game allows players to join sessions, generate tickets, and mark numbers in real-time for a fun and engaging experience.


### website will take upto 1/2 minutes to load, because i deploy the website for free.

## Features

- **Real-Time Gameplay:** Multiple players can join and play simultaneously.
- **Automated Number Generation:** System generates and calls out numbers automatically.
- **Ticket Management:** Players can generate and manage their tickets.
- **Win Conditions:** Automatic detection and announcement of winners.
- **Responsive Design:** Optimized for desktops, tablets, and smartphones.

## Technologies Used

- **Frontend:** React, Tailwind, Vite
- **Backend:** Node.js (Express), server-authoritative game engine
- **Real-Time Communication:** Socket.io
- **Persistence:** PostgreSQL (durable rooms, tickets, calls, claims, sessions)

> The server is the single source of truth. Tickets are issued and drawn by the
> server, claims are verified server-side, and every official call is committed
> to the database before it is broadcast. See
> [`server/DATABASE.md`](server/DATABASE.md) for the schema and recovery design
> and [`server/net/CONTRACT.md`](server/net/CONTRACT.md) for the Socket.IO
> protocol.

## Running it

```bash
# 1. install both workspaces
npm install
npm install --prefix client

# 2. point the server at a PostgreSQL instance (no database => memory mode,
#    which must be opted into with ALLOW_MEMORY_ONLY=1 and does not survive a
#    restart)
#    .env:
#      DATABASE_URL=postgres://user:pass@127.0.0.1:5432/tambola
#      DB_SCHEMA=public

# 3. build the client and run the server (migrates + recovers open rooms on boot)
npm run build
npm start

# tests: the durable suite runs when DATABASE_URL is reachable and otherwise
# skips cleanly; the engine/transport suites always run.
npm test
```


## Usage

1. **Start a Game Session:**
   - Launch the application and click on "Start New Game" to create a game session.
   - Share the generated session code with other players.

2. **Join the Game:**
   - Players can join the session by entering the session code on the home page and clicking "Join Game."

3. **Generate Tickets:**
   - Each player generates their own tickets by clicking on "Generate Ticket."
   - Tickets will be displayed on the player's screen.

4. **Play the Game:**
   - The system will automatically call out numbers.
   - Players mark off the numbers on their tickets as they are called.

5. **Winning:**
   - The game detects and announces winners based on predefined patterns (e.g., first row, full house).

## Game Rules

- **Tambola Basics:**
  - Each ticket contains a grid of numbers.
  - A caller (the system) generates random numbers.
  - Players mark the numbers on their tickets as they are called.

- **Winning Patterns:**
  - **First Row:** The first player to mark all numbers in the first row wins.
  - **Second Row:** the first player to mark all numbers in the second row wins.
  - **Third Row:** the first player to mark all numbers in the third row wins.
  - **Middle Number:** the first player to mark number on the middle element of the ticket.
  - **Early Five:** the first player to mark all numbers of early five wins.
  - **Early Seven:** the first player to mark all numbers of early seven wins.
  - **Star:** the first player to mark all numbers form star on ticket wins.
  - **Corner:** the first player to mark all numbers of corner on ticket wins.
  - **Full House:** The first player to mark all numbers on their ticket wins.

## Contributing

### read CONTRIBUTING.md.

Contributions are welcome! If you'd like to contribute to this project, please follow these steps:

1. Fork the repository.
2. Create a new branch (`git checkout -b feature-branch`).
3. Make your changes and commit them (`git commit -m 'Add some feature'`).
4. Push to the branch (`git push origin feature-branch`).
5. Open a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
