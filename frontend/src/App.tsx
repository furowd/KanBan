import { useEffect, useState, type FormEvent } from "react";
import { addCard, changeCardStatus, getCards, removeCard } from "./api";
import type { Card, Status } from "./types";

const columns: { status: Status; title: string }[] = [
  { status: "todo", title: "To do" },
  { status: "doing", title: "Doing" },
  { status: "done", title: "Done" },
];

function App() {
  const [cards, setCards] = useState<Card[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyCardIds, setBusyCardIds] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    getCards()
      .then(setCards)
      .catch((requestError: Error) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleAddCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setAdding(true);
    setError("");
    try {
      const card = await addCard(trimmedTitle);
      setCards((current) => [...current, card]);
      setTitle("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The card could not be added.",
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleStatusChange(id: number, status: Status) {
    setBusyCardIds((current) => new Set(current).add(id));
    setError("");
    try {
      const updatedCard = await changeCardStatus(id, status);
      setCards((current) =>
        current.map((card) => (card.id === id ? updatedCard : card)),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The card could not be moved.",
      );
    } finally {
      setBusyCardIds((current) => {
        const updated = new Set(current);
        updated.delete(id);
        return updated;
      });
    }
  }

  async function handleDelete(id: number) {
    setBusyCardIds((current) => new Set(current).add(id));
    setError("");
    try {
      await removeCard(id);
      setCards((current) => current.filter((card) => card.id !== id));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The card could not be deleted.",
      );
    } finally {
      setBusyCardIds((current) => {
        const updated = new Set(current);
        updated.delete(id);
        return updated;
      });
    }
  }

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">DAYMARK / WORKSPACE</p>
          <h1>Kanban board</h1>
          <p className="page-subtitle">
            A clear view of what’s next, in progress, and finished.
          </p>
        </div>
        <div className="board-count" aria-label={`${cards.length} cards`}>
          <span className="count-dot" />
          {cards.length} {cards.length === 1 ? "card" : "cards"}
        </div>
      </header>

      <form className="add-form" onSubmit={handleAddCard}>
        <label className="visually-hidden" htmlFor="new-card">
          Add a card to To do
        </label>
        <input
          id="new-card"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs to get done?"
          maxLength={500}
          disabled={adding}
        />
        <button type="submit" disabled={adding || !title.trim()}>
          {adding ? "Adding…" : "Add card"}
        </button>
      </form>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            className="dismiss-error"
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading-state" role="status">
          <span className="spinner" />
          Loading your board…
        </div>
      ) : (
        <section className="board" aria-label="Kanban board">
          {columns.map((column) => {
            const columnCards = cards.filter(
              (card) => card.status === column.status,
            );

            return (
              <section
                className={`column column-${column.status}`}
                key={column.status}
                aria-labelledby={`heading-${column.status}`}
              >
                <header className="column-header">
                  <div className="column-heading">
                    <span className={`status-dot dot-${column.status}`} />
                    <h2 id={`heading-${column.status}`}>{column.title}</h2>
                    <span className="column-count">{columnCards.length}</span>
                  </div>
                </header>
                <div className="card-list">
                  {columnCards.length === 0 ? (
                    <p className="empty-column">No cards yet</p>
                  ) : (
                    columnCards.map((card) => (
                      <article className="task-card" key={card.id}>
                        <p className="task-title">{card.title}</p>
                        <div className="task-actions">
                          <label
                            className="visually-hidden"
                            htmlFor={`status-${card.id}`}
                          >
                            Move {card.title}
                          </label>
                          <select
                            id={`status-${card.id}`}
                            value={card.status}
                            disabled={busyCardIds.has(card.id)}
                            onChange={(event) =>
                              handleStatusChange(
                                card.id,
                                event.target.value as Status,
                              )
                            }
                          >
                            {columns.map((option) => (
                              <option key={option.status} value={option.status}>
                                Move to {option.title}
                              </option>
                            ))}
                          </select>
                          <button
                            className="delete-button"
                            type="button"
                            disabled={busyCardIds.has(card.id)}
                            onClick={() => handleDelete(card.id)}
                            aria-label={`Delete ${card.title}`}
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </section>
      )}

      <footer className="page-footer">
        <span>Keep it moving, one card at a time.</span>
        <span>DAYMARK BOARD</span>
      </footer>
    </main>
  );
}

export default App;
