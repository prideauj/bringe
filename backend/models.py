from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Date, Time, Text, JSON, ForeignKey
from sqlalchemy.orm import relationship, declarative_base
from datetime import datetime

Base = declarative_base()


class Venue(Base):
    __tablename__ = "venues"

    id = Column(Integer, primary_key=True)
    slug = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    address = Column(String)
    url = Column(String)
    lat = Column(Float)
    lng = Column(Float)
    geocoded_at = Column(DateTime)
    shows = relationship("Show", back_populates="venue")


class Show(Base):
    __tablename__ = "shows"

    id = Column(Integer, primary_key=True)
    slug = Column(String, unique=True, nullable=False)
    url = Column(String, nullable=False)
    title = Column(String, nullable=False)
    company = Column(String)
    genre = Column(String)
    description = Column(Text)
    duration_minutes = Column(Integer)
    age_suitability = Column(String)
    image_url = Column(String)
    website = Column(String)
    instagram = Column(String)
    twitter = Column(String)
    facebook = Column(String)
    venue_id = Column(Integer, ForeignKey("venues.id"))
    accessibility_features = Column(JSON, default=list)
    content_warnings = Column(JSON, default=list)
    cast = Column(JSON, default=list)
    scraped_at = Column(DateTime, default=datetime.utcnow)

    venue = relationship("Venue", back_populates="shows")
    performances = relationship("Performance", back_populates="show", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="show", cascade="all, delete-orphan")


class Performance(Base):
    __tablename__ = "performances"

    id = Column(Integer, primary_key=True)
    show_id = Column(Integer, ForeignKey("shows.id"), nullable=False)
    date = Column(String, nullable=False)   # ISO date string "2026-05-08"
    time = Column(String)                   # "19:30"
    standard_price = Column(Float)
    concession_price = Column(Float)
    is_sold_out = Column(Boolean, default=False)
    booking_url = Column(String)

    show = relationship("Show", back_populates="performances")


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True)
    show_id = Column(Integer, ForeignKey("shows.id"), nullable=False)
    source_site = Column(String)            # "Broadway Baby", "Fringe Review", etc.
    reviewer = Column(String)
    rating_stars = Column(Float)            # 0-5 normalised
    rating_raw = Column(String)             # original "★★★★" or "4/5"
    excerpt = Column(Text)
    review_url = Column(String)
    fetched_at = Column(DateTime, default=datetime.utcnow)

    show = relationship("Show", back_populates="reviews")
