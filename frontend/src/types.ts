export type Status = "todo" | "doing" | "done";

export type Card = {
  id: number;
  title: string;
  status: Status;
  created_at: string;
};
