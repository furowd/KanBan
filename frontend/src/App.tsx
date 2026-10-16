import { useEffect, useState, type FormEvent } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { addCard, changeCardStatus, getCards, removeCard } from "./api";
import type { Card, Status } from "./types";

type ColumnDefinition = { status: Status; title: string };

const columns: ColumnDefinition[] = [
  { status: "todo", title: "To do" },
  { status: "doing", title: "Doing" },
  { status: "done", title: "Done" },
];

function isStatus(value: unknown): value is Status {
  return value === "todo" || value === "doing" || value === "done";
}

const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length ? pointerCollisions : rectIntersection(args);
};

type TaskCardProps = {
  card: Card;
  isBusy: boolean;
  onStatusChange: (id: number, status: Status) => void;
  onDelete: (id: number) => void;
};

function TaskCard({
  card,
  isBusy,
  onStatusChange,
  onDelete,
}: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `card-${card.id}`,
      data: { cardId: card.id },
      disabled: isBusy,
      attributes: { role: "group", roleDescription: "draggable task card" },
    });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 1,
      }
    : undefined;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-card${isDragging ? " task-card-dragging" : ""}`}
      aria-label={`${card.title}. Drag to move between columns, or use the status menu.`}
      {...attributes}
      {...listeners}
    >
      <p className="task-title">{card.title}</p>
      <div
        className="task-actions"
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <label className="visually-hidden" htmlFor={`status-${card.id}`}>
          Move {card.title}
        </label>
        <select
          id={`status-${card.id}`}
          value={card.status}
          disabled={isBusy}
          onChange={(event) =>
            onStatusChange(card.id, event.target.value as Status)
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
          disabled={isBusy}
          onClick={() => onDelete(card.id)}
          aria-label={`Delete ${card.title}`}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

type BoardColumnProps = {
  column: ColumnDefinition;
  cards: Card[];
  busyCardIds: Set<number>;
  onStatusChange: (id: number, status: Status) => void;
  onDelete: (id: number) => void;
};

function BoardColumn({
  column,
  cards,
  busyCardIds,
  onStatusChange,
  onDelete,
}: BoardColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: `column-${column.status}`,
    data: { status: column.status },
  });

  return (
    <section
      ref={setNodeRef}
      className={`column column-${column.status}${isOver ? " column-drop-target" : ""}`}
      aria-labelledby={`heading-${column.status}`}
    >
      <header className="column-header">
        <div className="column-heading">
          <span className={`status-dot dot-${column.status}`} />
          <h2 id={`heading-${column.status}`}>{column.title}</h2>
          <span className="column-count">{cards.length}</span>
        </div>
      </header>
      <div className="card-list">
        {cards.length === 0 ? (
          <p className="empty-column">No cards yet</p>
        ) : (
          cards.map((card) => (
            <TaskCard
              key={card.id}
              card={card}
              isBusy={busyCardIds.has(card.id)}
              onStatusChange={onStatusChange}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </section>
  );
}

function App() {
  const [cards, setCards] = useState<Card[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyCardIds, setBusyCardIds] = useState<Set<number>>(() => new Set());
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [activeCardWidth, setActiveCardWidth] = useState<number | undefined>();
  const [error, setError] = useState("");
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

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

  async function handleStatusChange(
    id: number,
    status: Status,
    optimistic = false,
  ) {
    const previousCard = cards.find((card) => card.id === id);
    if (!previousCard || previousCard.status === status || busyCardIds.has(id)) {
      return;
    }

    setBusyCardIds((current) => new Set(current).add(id));
    setError("");
    if (optimistic) {
      setCards((current) =>
        current.map((card) => (card.id === id ? { ...card, status } : card)),
      );
    }

    try {
      const updatedCard = await changeCardStatus(id, status);
      setCards((current) =>
        current.map((card) => (card.id === id ? updatedCard : card)),
      );
    } catch (requestError) {
      if (optimistic) {
        setCards((current) =>
          current.map((card) =>
            card.id === id ? { ...card, status: previousCard.status } : card,
          ),
        );
      }
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

  function handleDragStart(event: DragStartEvent) {
    const cardId = event.active.data.current?.cardId;
    const card = cards.find((item) => item.id === cardId);
    setActiveCard(card ?? null);
    setActiveCardWidth(event.active.rect.current.initial?.width);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    setActiveCardWidth(undefined);

    const cardId = event.active.data.current?.cardId;
    const destination = event.over?.data.current?.status;
    if (typeof cardId !== "number" || !isStatus(destination)) return;

    void handleStatusChange(cardId, destination, true);
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
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "Press Space or Enter to pick up a card, use the arrow keys to move it between columns, then press Space or Enter to drop it. Press Escape to cancel. You can also use the status menu.",
            },
          }}
          onDragStart={handleDragStart}
          onDragCancel={() => {
            setActiveCard(null);
            setActiveCardWidth(undefined);
          }}
          onDragEnd={handleDragEnd}
        >
          <section className="board" aria-label="Kanban board">
            {columns.map((column) => (
              <BoardColumn
                key={column.status}
                column={column}
                cards={cards.filter((card) => card.status === column.status)}
                busyCardIds={busyCardIds}
                onStatusChange={(id, status) =>
                  void handleStatusChange(id, status)
                }
                onDelete={(id) => void handleDelete(id)}
              />
            ))}
          </section>
          <DragOverlay dropAnimation={null}>
            {activeCard ? (
              <article
                className="task-card drag-overlay-card"
                style={{ width: activeCardWidth }}
                aria-hidden="true"
              >
                <p className="task-title">{activeCard.title}</p>
              </article>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <footer className="page-footer">
        <span>Keep it moving, one card at a time.</span>
        <span>DAYMARK BOARD</span>
      </footer>
    </main>
  );
}

export default App;
