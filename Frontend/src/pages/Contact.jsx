import { useState } from "react";
import toast from "react-hot-toast";
import { contactApi } from "../api";
import SiteNav from "../components/SiteNav";
import Footer from "../components/Footer";
import { spotlightMove } from "../utils/spotlight";
import "../styles/Contact.css";

export default function Contact() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) {
      toast.error("Name, email, and message are required.");
      return;
    }
    setLoading(true);
    try {
      await contactApi.submit(form);
      setSent(true);
      setForm({ name: "", email: "", subject: "", message: "" });
      toast.success("Message sent — thanks for reaching out.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SiteNav />

      <div className="contact-shell">
        <div className="contact-intro">
          <p className="contact-eyebrow">Get in touch</p>
          <h1 className="contact-title">Contact Us</h1>
          <p className="contact-sub">
            Questions about the project, a bug you found, or feedback on the carbon calculator's
            methodology — we read every message.
          </p>
        </div>

        <form className="contact-form spotlight" onMouseMove={spotlightMove} onSubmit={handleSubmit}>
          {sent && (
            <div className="contact-success">Thanks — your message has been received.</div>
          )}

          <div className="contact-row">
            <div className="contact-field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" />
            </div>
            <div className="contact-field">
              <label>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@email.com" />
            </div>
          </div>

          <div className="contact-field">
            <label>Subject</label>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="What's this about?" />
          </div>

          <div className="contact-field">
            <label>Message</label>
            <textarea rows="6" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Tell us more..." />
          </div>

          <button className="contact-submit" disabled={loading}>
            {loading ? "Sending…" : "Send message"}
          </button>
        </form>
      </div>

      <Footer />
    </>
  );
}
