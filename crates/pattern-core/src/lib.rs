use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point2 {
    pub id: String,
    pub x_mm: f64,
    pub y_mm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternPiece {
    pub id: String,
    pub name: String,
    pub seam_allowance_mm: f64,
    pub points: Vec<Point2>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternSnapshot {
    pub piece: PatternPiece,
    pub area_mm2: f64,
    pub perimeter_mm: f64,
    pub issues: Vec<String>,
}

#[wasm_bindgen]
pub struct PatternEngine {
    piece: PatternPiece,
}

#[wasm_bindgen]
impl PatternEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Self {
            piece: default_skirt_front(),
        }
    }

    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        to_js_value(&self.build_snapshot())
    }

    pub fn restore_piece(&mut self, piece: JsValue) -> Result<JsValue, JsValue> {
        let piece: PatternPiece = serde_wasm_bindgen::from_value(piece)
            .map_err(|error| JsValue::from_str(&format!("Molde salvo inválido: {error}")))?;
        validate_piece(&piece)?;
        self.piece = piece;
        to_js_value(&self.build_snapshot())
    }

    pub fn move_point(&mut self, point_id: &str, x_mm: f64, y_mm: f64) -> Result<JsValue, JsValue> {
        if !x_mm.is_finite() || !y_mm.is_finite() {
            return Err(JsValue::from_str("As coordenadas precisam ser números finitos."));
        }

        if let Some(point) = self.piece.points.iter_mut().find(|point| point.id == point_id) {
            point.x_mm = x_mm;
            point.y_mm = y_mm;
        }

        to_js_value(&self.build_snapshot())
    }

    pub fn set_seam_allowance(&mut self, value_mm: f64) -> Result<JsValue, JsValue> {
        if !value_mm.is_finite() {
            return Err(JsValue::from_str("A margem precisa ser um número finito."));
        }

        self.piece.seam_allowance_mm = value_mm.max(0.0);
        to_js_value(&self.build_snapshot())
    }

    pub fn reset(&mut self) -> Result<JsValue, JsValue> {
        self.piece = default_skirt_front();
        to_js_value(&self.build_snapshot())
    }
}

impl Default for PatternEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl PatternEngine {
    fn build_snapshot(&self) -> PatternSnapshot {
        let area_mm2 = polygon_area(&self.piece.points);
        let perimeter_mm = polygon_perimeter(&self.piece.points);
        let mut issues = Vec::new();

        if self.piece.points.len() < 3 {
            issues.push("O contorno precisa de pelo menos três pontos.".to_string());
        }

        if area_mm2 < 1.0 {
            issues.push("O contorno não possui área suficiente.".to_string());
        }

        if self
            .piece
            .points
            .iter()
            .any(|point| !point.x_mm.is_finite() || !point.y_mm.is_finite())
        {
            issues.push("Existe um ponto com coordenada inválida.".to_string());
        }

        PatternSnapshot {
            piece: self.piece.clone(),
            area_mm2,
            perimeter_mm,
            issues,
        }
    }
}

fn default_skirt_front() -> PatternPiece {
    PatternPiece {
        id: "skirt-front".to_string(),
        name: "Saia base — frente".to_string(),
        seam_allowance_mm: 10.0,
        points: vec![
            Point2 { id: "waist-left".to_string(), x_mm: 0.0, y_mm: 0.0 },
            Point2 { id: "waist-right".to_string(), x_mm: 260.0, y_mm: 0.0 },
            Point2 { id: "hem-right".to_string(), x_mm: 315.0, y_mm: 620.0 },
            Point2 { id: "hem-left".to_string(), x_mm: -20.0, y_mm: 620.0 },
        ],
    }
}

fn validate_piece(piece: &PatternPiece) -> Result<(), JsValue> {
    if piece.points.len() < 3 {
        return Err(JsValue::from_str("O contorno precisa de pelo menos três pontos."));
    }

    if !piece.seam_allowance_mm.is_finite() || piece.seam_allowance_mm < 0.0 {
        return Err(JsValue::from_str("A margem de costura precisa ser um número finito e não negativo."));
    }

    if piece
        .points
        .iter()
        .any(|point| !point.x_mm.is_finite() || !point.y_mm.is_finite())
    {
        return Err(JsValue::from_str("Existe um ponto com coordenada inválida."));
    }

    Ok(())
}

fn polygon_area(points: &[Point2]) -> f64 {
    if points.len() < 3 {
        return 0.0;
    }

    let mut twice_area = 0.0;
    for index in 0..points.len() {
        let current = &points[index];
        let next = &points[(index + 1) % points.len()];
        twice_area += current.x_mm * next.y_mm - next.x_mm * current.y_mm;
    }

    twice_area.abs() / 2.0
}

fn polygon_perimeter(points: &[Point2]) -> f64 {
    if points.len() < 2 {
        return 0.0;
    }

    points
        .iter()
        .enumerate()
        .map(|(index, current)| {
            let next = &points[(index + 1) % points.len()];
            (next.x_mm - current.x_mm).hypot(next.y_mm - current.y_mm)
        })
        .sum()
}

fn to_js_value<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculates_square_area() {
        let points = vec![
            Point2 { id: "a".into(), x_mm: 0.0, y_mm: 0.0 },
            Point2 { id: "b".into(), x_mm: 100.0, y_mm: 0.0 },
            Point2 { id: "c".into(), x_mm: 100.0, y_mm: 100.0 },
            Point2 { id: "d".into(), x_mm: 0.0, y_mm: 100.0 },
        ];

        assert_eq!(polygon_area(&points), 10_000.0);
        assert_eq!(polygon_perimeter(&points), 400.0);
    }
}
