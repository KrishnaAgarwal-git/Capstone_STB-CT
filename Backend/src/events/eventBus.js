import { EventEmitter } from "events";

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);

export const EVENTS = {
  TRANSACTION_COMPLETED: "transaction.completed",
  TRANSACTION_DISPUTED: "transaction.disputed",
  CARBON_LOGGED: "carbon.logged",
  CARBON_REVERSED: "carbon.reversed",
};
