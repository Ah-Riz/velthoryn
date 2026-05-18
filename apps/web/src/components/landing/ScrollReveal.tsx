"use client";

import { useEffect } from "react";

export function ScrollReveal() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll(".lp-reveal, .lp-reveal-stagger").forEach((el) => {
        el.classList.add("in");
      });
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );

    document.querySelectorAll(".lp-reveal, .lp-reveal-stagger").forEach((el) => {
      io.observe(el);
    });

    return () => io.disconnect();
  }, []);

  return null;
}
